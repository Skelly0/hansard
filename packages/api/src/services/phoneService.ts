import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, count, type SQL } from 'drizzle-orm';
import {
  phoneNumbers,
  phoneCalls,
  phoneMessages,
  phoneThreads,
  phoneTaps,
  phoneTapAuditLog,
  phoneMessageTapDeliveries,
  players,
  type Database,
} from '@hansard/db';
import {
  PHONE_RING_TIMEOUT_MS,
  PHONE_STRANDED_CALL_MAX_AGE_MS,
  PHONE_STALE_TAP_DELIVERY_MAX_AGE_MS,
  PHONE_NUMBERS_PER_PLAYER_LIMIT,
  PHONE_INELIGIBLE_DEAD,
  PHONE_INELIGIBLE_NO_CHARACTER,
  PHONE_ALREADY_ON_CALL,
  PHONE_NUMBER_TAKEN,
  PHONE_NUMBER_INVALID,
  PHONE_NUMBER_NOT_FOUND,
  PHONE_FORCE_END_REASON_PREFIX,
  PHONE_TAP_FAILURE_THRESHOLD,
  isValidPhoneNumber,
  normalizePhoneNumber,
} from '@hansard/shared';

// ============================================================
// Types
// ============================================================

export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type PhoneCall = typeof phoneCalls.$inferSelect;
export type PhoneMessage = typeof phoneMessages.$inferSelect;
export type PhoneTap = typeof phoneTaps.$inferSelect;
export type PhoneThread = typeof phoneThreads.$inferSelect;
export type PhoneMessageTapDelivery = typeof phoneMessageTapDeliveries.$inferSelect;

/**
 * `recordMessage` returns the persisted transcript row **plus** a placeholder
 * `phone_message_tap_deliveries` row for every tap that was active at insert time. The
 * placeholders are written inside the same transaction as the message, so the invariant
 * "every tap delivery for an active tap has a row" holds even if the relay crashes between
 * the commit and the Discord send. The relay later fills each placeholder in with the send
 * result via `completeTapDelivery`.
 */
export interface RecordedMessage {
  message: PhoneMessage;
  /** One pending delivery row per tap active at insert time — relay fills these in. */
  tapDeliveries: PhoneMessageTapDelivery[];
}

export interface CallParticipantSummary {
  playerId: string;
  characterName: string | null;
  discordUsername: string | null;
  discordId: string | null;
  numberRaw: string | null;
}
export interface EnrichedPhoneCall extends PhoneCall {
  caller: CallParticipantSummary;
  recipient: CallParticipantSummary;
}

export interface PhoneDirectoryEntry {
  id: string;
  playerId: string;
  numberRaw: string;
  numberNormalized: string;
  label: string | null;
  characterName: string;
  discordUsername: string;
}

export interface PhoneViewer {
  userId: string;
  isStaff: boolean;
}

export interface RegisterNumberInput {
  playerId: string;
  numberRaw: string;
  label?: string | null;
}

export interface InitiateCallInput {
  callerPlayerId: string;
  callerNumberId: string;
  recipientNumberId: string;
  ringDiscordMessageId?: string | null;
}

export interface RecordMessageInput {
  callId: string;
  senderPlayerId: string;
  content: string;
  senderDiscordMessageId?: string | null;
}

export interface SetTapInput {
  targetNumberId: string;
  createdById: string;
  reason?: string | null;
  mirrorChannelId?: string | null;
  /** Raw Discord snowflake — distinct from `createdById` which is a player UUID. */
  mirrorDiscordUserId?: string | null;
}

export interface CallParticipants {
  call: PhoneCall;
  callerNumber: PhoneNumber;
  recipientNumber: PhoneNumber;
  callerPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
  recipientPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
}

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Custom error subclass so callers (Discord commands, web routes) can map known refusals
 * to friendly UI replies without parsing message strings.
 */
export class PhoneServiceError extends Error {
  constructor(public code: PhoneErrorCode, message: string) {
    super(message);
    this.name = 'PhoneServiceError';
  }
}

export type PhoneErrorCode =
  | 'invalid_number'
  | 'number_taken'
  | 'number_not_found'
  | 'no_character'
  | 'dead'
  | 'already_on_call'
  | 'recipient_dead'
  | 'self_call'
  | 'forbidden'
  | 'not_found'
  | 'limit_reached'
  | 'invalid_state';

/**
 * Strip control + Unicode-format characters and reject anything outside the printable
 * phone-shape ASCII whitelist. A player can otherwise smuggle zero-width joiners, bidi
 * marks, or decoration into `numberRaw` (which is displayed verbatim in DMs and embeds);
 * `numberNormalized` is already shape-checked by a DB CHECK, but `numberRaw` is not.
 * Whitelist: `+`, digits, `(`, `)`, `-`, and space.
 */
function sanitizeNumberRaw(input: string): string {
  return input.replace(/[^+0-9()\- ]/gu, '').trim();
}

// ============================================================
// Service
// ============================================================

export class PhoneService {
  constructor(private db: Database) {}

  // ----------------------------------------------------------
  // Number registration
  // ----------------------------------------------------------

  async registerNumber(input: RegisterNumberInput): Promise<PhoneNumber> {
    if (!isValidPhoneNumber(input.numberRaw)) {
      throw new PhoneServiceError('invalid_number', PHONE_NUMBER_INVALID);
    }
    const normalized = normalizePhoneNumber(input.numberRaw);
    // `numberRaw` is rendered verbatim in DMs/embeds — strip control/format characters so a
    // player can't store zero-width joiners or bidi marks. The shape was already validated
    // above; sanitization just removes anything outside the printable phone-shape whitelist.
    const sanitizedRaw = sanitizeNumberRaw(input.numberRaw);

    return this.db.transaction(async (tx) => {
      await lockPhoneKey(tx, 'player', input.playerId);

      const [player] = await tx
        .select({
          id: players.id,
          characterName: players.characterName,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(eq(players.id, input.playerId))
        .limit(1);

      if (!player) throw new PhoneServiceError('not_found', 'Player not found.');
      if (!player.characterName) {
        throw new PhoneServiceError('no_character', PHONE_INELIGIBLE_NO_CHARACTER);
      }
      if (!player.isAlive) {
        throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
      }

      const [{ value: activeCount }] = await tx
        .select({ value: count() })
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.playerId, input.playerId), eq(phoneNumbers.isActive, true)));

      if (activeCount >= PHONE_NUMBERS_PER_PLAYER_LIMIT) {
        throw new PhoneServiceError(
          'limit_reached',
          `You already have ${PHONE_NUMBERS_PER_PLAYER_LIMIT} active phone numbers. Delete one before registering another.`,
        );
      }

      try {
        const [row] = await tx
          .insert(phoneNumbers)
          .values({
            playerId: input.playerId,
            numberRaw: sanitizedRaw,
            numberNormalized: normalized,
            label: input.label ?? null,
            cachedCharacterName: player.characterName,
          })
          .returning();
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new PhoneServiceError('number_taken', PHONE_NUMBER_TAKEN);
        }
        throw err;
      }
    });
  }

  async listMyNumbers(playerId: string): Promise<PhoneNumber[]> {
    return this.db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.playerId, playerId), eq(phoneNumbers.isActive, true)))
      .orderBy(desc(phoneNumbers.createdAt));
  }

  async listDirectory(): Promise<PhoneDirectoryEntry[]> {
    const rows = await this.db
      .select({
        id: phoneNumbers.id,
        playerId: phoneNumbers.playerId,
        numberRaw: phoneNumbers.numberRaw,
        numberNormalized: phoneNumbers.numberNormalized,
        label: phoneNumbers.label,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(phoneNumbers)
      .innerJoin(players, eq(phoneNumbers.playerId, players.id))
      .where(and(
        eq(phoneNumbers.isActive, true),
        eq(players.isAlive, true),
        isNotNull(players.characterName),
      ))
      .orderBy(asc(players.characterName), asc(phoneNumbers.numberRaw));

    return rows.flatMap((row) =>
      row.characterName
        ? [{
            ...row,
            characterName: row.characterName,
          }]
        : [],
    );
  }

  async deactivateNumber(numberId: string, actingPlayerId: string, viewer: PhoneViewer): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockPhoneKey(tx, 'number', numberId);

      const [row] = await tx
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, numberId))
        .limit(1);

      if (!row || !row.isActive) {
        throw new PhoneServiceError('not_found', 'No such active number.');
      }
      if (!viewer.isStaff && row.playerId !== actingPlayerId) {
        throw new PhoneServiceError('forbidden', 'You can only delete your own phone numbers.');
      }
      await lockPhoneKey(tx, 'player', row.playerId);

      // Refuse if the line is on an open call — caller would lose mid-call routing and the
      // recipient's UI would show a number that no longer exists. Staff can force-end first.
      const [openCall] = await tx
        .select({ id: phoneCalls.id })
        .from(phoneCalls)
        .where(
          and(
            inArray(phoneCalls.status, ['ringing', 'active']),
            or(eq(phoneCalls.callerNumberId, numberId), eq(phoneCalls.recipientNumberId, numberId)),
          ),
        )
        .limit(1);
      if (openCall) {
        throw new PhoneServiceError(
          'invalid_state',
          'That number is currently on a call. Hang up first, then try again.',
        );
      }

      await tx
        .update(phoneNumbers)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(and(eq(phoneNumbers.id, numberId), eq(phoneNumbers.isActive, true)));

      // Auto-revoke any active taps on this number — a tap on a retired number silently never
      // fires but still shows live in `tap-list`, which misleads staff. Done in the same
      // transaction so the number + its taps flip atomically; one audit row per revoked tap
      // with action `number_deactivated` keeps the rogue-staff audit chain reconstructible.
      const revokedTaps = await tx
        .update(phoneTaps)
        .set({ isActive: false, revokedAt: new Date(), revokedById: actingPlayerId })
        .where(and(eq(phoneTaps.targetNumberId, numberId), eq(phoneTaps.isActive, true)))
        .returning();
      if (revokedTaps.length) {
        await tx.insert(phoneTapAuditLog).values(
          revokedTaps.map((tap) => ({
            tapId: tap.id,
            actorId: actingPlayerId,
            action: 'number_deactivated' as const,
            targetNumberId: tap.targetNumberId,
            targetNumberNormalized: row.numberNormalized,
            mirrorChannelId: tap.mirrorChannelId,
            mirrorDiscordUserId: tap.mirrorDiscordUserId,
            notes: 'Tap auto-revoked: target number was deactivated.',
          })),
        );
      }
    });
  }

  async lookupNumber(numberRaw: string): Promise<PhoneNumber | null> {
    if (!isValidPhoneNumber(numberRaw)) return null;
    const normalized = normalizePhoneNumber(numberRaw);
    const [row] = await this.db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.numberNormalized, normalized), eq(phoneNumbers.isActive, true)))
      .limit(1);
    return row ?? null;
  }

  // ----------------------------------------------------------
  // Call lifecycle
  // ----------------------------------------------------------

  async initiateCall(input: InitiateCallInput): Promise<CallParticipants> {
    return this.db.transaction(async (tx) => {
      await lockPhoneKeys(tx, [
        ['number', input.callerNumberId],
        ['number', input.recipientNumberId],
      ]);

      const [callerNumber] = await tx
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, input.callerNumberId))
        .limit(1);
      const [recipientNumber] = await tx
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, input.recipientNumberId))
        .limit(1);

      if (!callerNumber || !callerNumber.isActive) {
        throw new PhoneServiceError('number_not_found', 'Your calling number is not active.');
      }
      if (!recipientNumber || !recipientNumber.isActive) {
        throw new PhoneServiceError('number_not_found', PHONE_NUMBER_NOT_FOUND);
      }
      if (callerNumber.playerId !== input.callerPlayerId) {
        throw new PhoneServiceError('forbidden', 'You can only dial from your own numbers.');
      }
      if (recipientNumber.playerId === input.callerPlayerId) {
        throw new PhoneServiceError('self_call', 'You cannot call yourself.');
      }

      await lockPhoneKeys(tx, [
        ['player', callerNumber.playerId],
        ['player', recipientNumber.playerId],
      ]);

      const [callerPlayer] = await tx
        .select({
          id: players.id,
          characterName: players.characterName,
          discordId: players.discordId,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(eq(players.id, callerNumber.playerId))
        .limit(1);
      const [recipientPlayer] = await tx
        .select({
          id: players.id,
          characterName: players.characterName,
          discordId: players.discordId,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(eq(players.id, recipientNumber.playerId))
        .limit(1);

      if (!callerPlayer || !callerPlayer.characterName) {
        throw new PhoneServiceError('no_character', PHONE_INELIGIBLE_NO_CHARACTER);
      }
      if (!callerPlayer.isAlive) {
        throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
      }
      if (!recipientPlayer) {
        throw new PhoneServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
      }
      if (!recipientPlayer.isAlive) {
        throw new PhoneServiceError('recipient_dead', PHONE_INELIGIBLE_DEAD);
      }
      if (!recipientPlayer.characterName) {
        // Recipient is an OAuth placeholder without a character.
        throw new PhoneServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
      }

      const [openCall] = await tx
        .select({ id: phoneCalls.id })
        .from(phoneCalls)
        .where(
          and(
            inArray(phoneCalls.status, ['ringing', 'active']),
            or(
              eq(phoneCalls.callerPlayerId, callerPlayer.id),
              eq(phoneCalls.recipientPlayerId, callerPlayer.id),
              eq(phoneCalls.callerPlayerId, recipientPlayer.id),
              eq(phoneCalls.recipientPlayerId, recipientPlayer.id),
            ),
          ),
        )
        .limit(1);
      if (openCall) {
        throw new PhoneServiceError('already_on_call', PHONE_ALREADY_ON_CALL);
      }

      const ringExpiresAt = new Date(Date.now() + PHONE_RING_TIMEOUT_MS);

      let call: PhoneCall;
      try {
        const [row] = await tx
          .insert(phoneCalls)
          .values({
            callerNumberId: callerNumber.id,
            recipientNumberId: recipientNumber.id,
            callerPlayerId: callerPlayer.id,
            recipientPlayerId: recipientPlayer.id,
            status: 'ringing',
            ringExpiresAt,
            ringDiscordMessageId: input.ringDiscordMessageId ?? null,
          })
          .returning();
        call = row;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new PhoneServiceError('already_on_call', PHONE_ALREADY_ON_CALL);
        }
        throw err;
      }

      return {
        call,
        callerNumber,
        recipientNumber,
        callerPlayer,
        recipientPlayer,
      };
    });
  }

  /**
   * Recipient answers a ringing call. Wrapped in a transaction with `SELECT ... FOR UPDATE`
   * on the call row: the ring-expiry check, the alive re-check, and the state UPDATE all see
   * a consistent snapshot, so a `/time advance` death finalization cannot land between the
   * alive check and the UPDATE and let a now-dead character answer.
   */
  async answerCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    return this.db.transaction(async (tx) => {
      const [call] = await tx
        .select()
        .from(phoneCalls)
        .where(eq(phoneCalls.id, callId))
        .for('update')
        .limit(1);
      if (!call) throw new PhoneServiceError('not_found', 'Call not found.');
      if (call.recipientPlayerId !== actingPlayerId) {
        throw new PhoneServiceError('forbidden', 'Only the recipient can answer this call.');
      }
      if (call.status !== 'ringing') {
        throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
      }
      const now = new Date();
      if (call.ringExpiresAt && call.ringExpiresAt <= now) {
        throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
      }
      // Alive re-check inside the txn — the FOR UPDATE lock above means a concurrent death
      // finalization either committed before our snapshot (we see isAlive=false here) or is
      // serialized after our UPDATE.
      const [actor] = await tx
        .select({ isAlive: players.isAlive })
        .from(players)
        .where(eq(players.id, actingPlayerId))
        .for('update')
        .limit(1);
      if (!actor || !actor.isAlive) {
        throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
      }

      const [updated] = await tx
        .update(phoneCalls)
        .set({ status: 'active', answeredAt: now })
        .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing')))
        .returning();
      if (!updated) {
        throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
      }
      return updated;
    });
  }

  /**
   * Recipient declines a ringing call. Same transactional `FOR UPDATE` discipline as
   * `answerCall` so the alive re-check and the state UPDATE cannot straddle a death.
   */
  async declineCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    return this.db.transaction(async (tx) => {
      const [call] = await tx
        .select()
        .from(phoneCalls)
        .where(eq(phoneCalls.id, callId))
        .for('update')
        .limit(1);
      if (!call) throw new PhoneServiceError('not_found', 'Call not found.');
      if (call.recipientPlayerId !== actingPlayerId) {
        throw new PhoneServiceError('forbidden', 'Only the recipient can decline this call.');
      }
      if (call.status !== 'ringing') {
        throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
      }
      const now = new Date();
      if (call.ringExpiresAt && call.ringExpiresAt <= now) {
        throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
      }
      const [actor] = await tx
        .select({ isAlive: players.isAlive })
        .from(players)
        .where(eq(players.id, actingPlayerId))
        .for('update')
        .limit(1);
      if (!actor || !actor.isAlive) {
        throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
      }

      const [updated] = await tx
        .update(phoneCalls)
        .set({ status: 'declined', endedAt: now, endedReason: 'declined_by_recipient' })
        .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing')))
        .returning();
      if (!updated) {
        throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
      }
      return updated;
    });
  }

  /**
   * Player-initiated hangup. The ended reason is **always derived from the actor's role and
   * call state** — callers can't pass `'hangup_recipient'` and vice versa. The four cases:
   *   - caller hangs up while ringing → `cancelled_by_caller` (status flips to `'ended'`)
   *   - caller hangs up while active  → `hangup_caller`
   *   - recipient hangs up while ringing → `declined_by_recipient` (status flips to `'declined'`,
   *     mirroring the dedicated `declineCall` path so audit reads stay aligned regardless of
   *     entry point — slash hangup vs. Decline button)
   *   - recipient hangs up while active  → `hangup_recipient`
   * System reasons (`relay_failed`, `dm_closed`, ring expiry, force-end by staff) have
   * dedicated methods below.
   */
  async endCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    const isCaller = call.callerPlayerId === actingPlayerId;
    const isRecipient = call.recipientPlayerId === actingPlayerId;
    if (!isCaller && !isRecipient) {
      throw new PhoneServiceError('forbidden', 'Only call participants can end this call.');
    }
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }

    const isRinging = call.status === 'ringing';
    const endedReason: 'hangup_caller' | 'hangup_recipient' | 'cancelled_by_caller' | 'declined_by_recipient' =
      isRinging && isCaller
        ? 'cancelled_by_caller'
        : isRinging
          ? 'declined_by_recipient'
          : isCaller
            ? 'hangup_caller'
            : 'hangup_recipient';
    // Use 'declined' as the terminal status for a recipient-ringing decline so the audit
    // matches the button-driven `declineCall` path; everything else lands on 'ended'.
    const terminalStatus: 'ended' | 'declined' = endedReason === 'declined_by_recipient' ? 'declined' : 'ended';

    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: terminalStatus, endedAt: new Date(), endedReason })
      .where(and(eq(phoneCalls.id, callId), inArray(phoneCalls.status, ['ringing', 'active'])))
      .returning();

    if (!updated) {
      throw new PhoneServiceError('invalid_state', 'Call is already ended.');
    }
    return updated;
  }

  /**
   * System-initiated termination — used by the relay (DM closed mid-call), the ring-timeout
   * worker, the startup stranded-call sweeper, and `forceEndCall`. Skips actor validation;
   * the caller of *this method* is the bot itself.
   */
  async systemEndCall(
    callId: string,
    reason: 'ring_timeout' | 'dm_closed' | 'relay_failed' | 'session_reset' | 'number_deactivated',
  ): Promise<PhoneCall | null> {
    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: reason === 'ring_timeout' ? 'missed' : 'ended', endedAt: new Date(), endedReason: reason })
      .where(and(eq(phoneCalls.id, callId), inArray(phoneCalls.status, ['ringing', 'active'])))
      .returning();
    return updated ?? null;
  }

  /**
   * Staff force-end. Records the acting staff member's player UUID on `phone_calls.force_ended_by_id`
   * so the audit trail is queryable without parsing `ended_reason`. The reason note is sliced to
   * 59 chars — `varchar(80)` minus `'force_ended_by_staff:'` (21 chars) — so the full slash-
   * option max-length-64 input is preserved up to the column budget instead of being truncated
   * to 48 unnecessarily.
   *
   * Takes a `viewer: PhoneViewer` and refuses non-staff at the service boundary — `setTap` /
   * `revokeTap` / `listTaps` already do this, and `forceEndCall` previously trusted the
   * `actingStaffId` param with no check. `actingStaffId` is still the recorded actor (it may
   * differ from `viewer.userId` only in tooling that acts on a staff member's behalf; the
   * normal Discord caller passes the same id for both).
   */
  async forceEndCall(
    callId: string,
    actingStaffId: string,
    viewer: PhoneViewer,
    reason?: string,
  ): Promise<PhoneCall> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can force-end calls.');
    }
    const call = await this.requireCall(callId);
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }
    const [updated] = await this.db
      .update(phoneCalls)
      .set({
        status: 'ended',
        endedAt: new Date(),
        endedReason: reason ? `${PHONE_FORCE_END_REASON_PREFIX}${reason.slice(0, 59)}` : 'force_ended_by_staff',
        forceEndedById: actingStaffId,
      })
      .where(and(eq(phoneCalls.id, callId), inArray(phoneCalls.status, ['ringing', 'active'])))
      .returning();
    if (!updated) {
      throw new PhoneServiceError('invalid_state', 'Call already ended.');
    }
    return updated;
  }

  /** Persist the ring DM message id so terminal transitions can disable stale buttons. */
  async setRingMessageId(callId: string, messageId: string): Promise<void> {
    await this.db
      .update(phoneCalls)
      .set({ ringDiscordMessageId: messageId })
      .where(and(eq(phoneCalls.id, callId), sql`ring_discord_message_id IS NULL`));
  }

  async setStaffThread(callId: string, threadId: string): Promise<void> {
    await this.db
      .update(phoneCalls)
      .set({ staffThreadId: threadId })
      .where(and(eq(phoneCalls.id, callId), sql`staff_thread_id IS NULL`));
  }

  /**
   * Find the player's currently open call (ringing or active) for routing inbound DMs.
   *
   * Implemented as two sequential single-column lookups instead of a `WHERE … OR …` on
   * (caller, recipient). Each lookup hits its partial unique index
   * (`phone_calls_one_open_{caller,recipient}` WHERE status IN ('ringing','active')) with
   * zero scan; the planner-fragile `BitmapOr` of two partial unique indexes is sidestepped.
   * The partial unique indexes guarantee at most one row per role per player, so this is
   * O(2 × index_lookup), not O(N).
   */
  async findOpenCallForPlayer(playerId: string): Promise<PhoneCall | null> {
    const [callerSide] = await this.db
      .select()
      .from(phoneCalls)
      .where(
        and(
          eq(phoneCalls.callerPlayerId, playerId),
          inArray(phoneCalls.status, ['ringing', 'active']),
        ),
      )
      .limit(1);
    if (callerSide) return callerSide;

    const [recipientSide] = await this.db
      .select()
      .from(phoneCalls)
      .where(
        and(
          eq(phoneCalls.recipientPlayerId, playerId),
          inArray(phoneCalls.status, ['ringing', 'active']),
        ),
      )
      .limit(1);
    return recipientSide ?? null;
  }

  async getCallParticipants(callId: string): Promise<CallParticipants> {
    const call = await this.requireCall(callId);
    // Hot path on every relayed message — run the 4 lookups in parallel.
    const [[callerNumber], [recipientNumber], [callerPlayer], [recipientPlayer]] = await Promise.all([
      this.db.select().from(phoneNumbers).where(eq(phoneNumbers.id, call.callerNumberId)).limit(1),
      this.db.select().from(phoneNumbers).where(eq(phoneNumbers.id, call.recipientNumberId)).limit(1),
      this.db
        .select({
          id: players.id,
          characterName: players.characterName,
          discordId: players.discordId,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(eq(players.id, call.callerPlayerId))
        .limit(1),
      this.db
        .select({
          id: players.id,
          characterName: players.characterName,
          discordId: players.discordId,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(eq(players.id, call.recipientPlayerId))
        .limit(1),
    ]);

    if (!callerNumber || !recipientNumber || !callerPlayer || !recipientPlayer) {
      throw new PhoneServiceError('not_found', 'Call participants no longer exist.');
    }
    return { call, callerNumber, recipientNumber, callerPlayer, recipientPlayer };
  }

  // ----------------------------------------------------------
  // Messages
  // ----------------------------------------------------------

  /**
   * Persist a relayed message into the call's frozen transcript. Wrapped in a transaction
   * with `SELECT ... FOR UPDATE` on the call row so a concurrent `endCall` / `systemEndCall`
   * cannot transition the call between our status check and the insert — the invariant
   * "messages exist only on calls that were active when the message arrived" must hold
   * regardless of timing.
   *
   * H1: also snapshots the active taps on both call numbers and writes a *placeholder*
   * `phone_message_tap_deliveries` row per tap inside this same transaction. Previously the
   * relay posted to Discord and then called `recordTapDelivery` per tap *after* the message
   * commit — a crash in that window left an active tap with no delivery row, breaking the
   * "every tap delivery for an active tap has a row" audit invariant. Now the rows exist the
   * moment the message commits; the relay fills in the send result via `completeTapDelivery`.
   */
  async recordMessage(input: RecordMessageInput): Promise<RecordedMessage> {
    return this.db.transaction(async (tx) => {
      const [call] = await tx
        .select()
        .from(phoneCalls)
        .where(eq(phoneCalls.id, input.callId))
        .for('update')
        .limit(1);
      if (!call) throw new PhoneServiceError('not_found', 'Call not found.');
      if (call.status !== 'active') {
        throw new PhoneServiceError('invalid_state', `Call is ${call.status}, cannot record messages.`);
      }
      if (call.callerPlayerId !== input.senderPlayerId && call.recipientPlayerId !== input.senderPlayerId) {
        throw new PhoneServiceError('forbidden', 'You are not in this call.');
      }
      const [sender] = await tx
        .select({ isAlive: players.isAlive })
        .from(players)
        .where(eq(players.id, input.senderPlayerId))
        .for('update')
        .limit(1);
      if (!sender || !sender.isAlive) {
        throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
      }

      const [row] = await tx
        .insert(phoneMessages)
        .values({
          callId: input.callId,
          senderPlayerId: input.senderPlayerId,
          content: input.content,
          senderDiscordMessageId: input.senderDiscordMessageId ?? null,
        })
        .returning();

      // Snapshot the active taps on both call numbers *inside the transaction* and write a
      // pending delivery placeholder per tap. `deliveredAt`/`mirrorMessageId`/`error` stay
      // null until the relay reports the Discord send result.
      const activeTaps = await tx
        .select()
        .from(phoneTaps)
        .where(
          and(
            inArray(phoneTaps.targetNumberId, [call.callerNumberId, call.recipientNumberId]),
            eq(phoneTaps.isActive, true),
          ),
        );
      let tapDeliveries: PhoneMessageTapDelivery[] = [];
      if (activeTaps.length) {
        tapDeliveries = await tx
          .insert(phoneMessageTapDeliveries)
          .values(
            activeTaps.map((tap) => ({
              messageId: row.id,
              tapId: tap.id,
              mirrorMessageId: null,
              deliveredAt: null,
              error: null,
            })),
          )
          .returning();
      }
      return { message: row, tapDeliveries };
    });
  }

  async updateMessageMirrorIds(
    messageId: string,
    ids: { recipientDiscordMessageId?: string | null; staffMirrorMessageId?: string | null },
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (ids.recipientDiscordMessageId !== undefined) update.recipientDiscordMessageId = ids.recipientDiscordMessageId;
    if (ids.staffMirrorMessageId !== undefined) update.staffMirrorMessageId = ids.staffMirrorMessageId;
    if (!Object.keys(update).length) return;
    await this.db.update(phoneMessages).set(update).where(eq(phoneMessages.id, messageId));
  }

  // ----------------------------------------------------------
  // Threads (per unordered pair)
  // ----------------------------------------------------------

  async findOrReserveThread(
    callerPlayerId: string,
    recipientPlayerId: string,
  ): Promise<{ thread: PhoneThread | null; pair: [string, string] }> {
    const [a, b] = [callerPlayerId, recipientPlayerId].sort() as [string, string];
    const [row] = await this.db
      .select()
      .from(phoneThreads)
      .where(and(eq(phoneThreads.playerAId, a), eq(phoneThreads.playerBId, b)))
      .limit(1);
    return { thread: row ?? null, pair: [a, b] };
  }

  async persistThread(
    pair: [string, string],
    discordThreadId: string,
  ): Promise<PhoneThread> {
    try {
      const [row] = await this.db
        .insert(phoneThreads)
        .values({ playerAId: pair[0], playerBId: pair[1], discordThreadId })
        .returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const [existing] = await this.db
          .select()
          .from(phoneThreads)
          .where(and(eq(phoneThreads.playerAId, pair[0]), eq(phoneThreads.playerBId, pair[1])))
          .limit(1);
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * H5: cross-process-safe find-or-create for the per-pair staff thread.
   *
   * The bot's in-memory `threadCreateLocks` Map is single-process only — across a restart or
   * a multi-shard deployment, two relays both see "no thread", both create a Discord thread,
   * one INSERT loses the `phone_threads_pair_unique` index, and the loser's Discord thread is
   * orphaned (a private thread nobody references).
   *
   * This wraps the whole find → create → persist sequence in a transaction that first takes
   * a `pg_advisory_xact_lock` on the sorted pair key. Only one transaction at a time can be
   * in the create section for a given pair, cluster-wide. `createThread` (the Discord call,
   * supplied by the relay so the service stays Discord-agnostic) only runs if no row exists.
   * If the INSERT still trips a unique violation (e.g. the discord_thread_id index, or a
   * lock-timeout edge), `onOrphan` is invoked so the relay can delete the just-created
   * Discord thread, and the pre-existing row is returned.
   */
  async findOrCreateThread(
    callerPlayerId: string,
    recipientPlayerId: string,
    hooks: {
      /** Create the Discord thread and return its id. Only called when no row exists yet. */
      createThread: (pair: [string, string]) => Promise<string | null>;
      /** Delete an orphaned Discord thread when this caller lost the persist race. */
      onOrphan?: (discordThreadId: string) => Promise<void>;
      /** Replace this persisted Discord thread id if the relay already proved it is stale. */
      replaceThreadId?: string;
    },
  ): Promise<{ thread: PhoneThread | null; created: boolean }> {
    const [a, b] = [callerPlayerId, recipientPlayerId].sort() as [string, string];
    let createdDiscordThreadId: string | null = null;
    try {
      return await this.db.transaction(async (tx) => {
        // Cluster-wide mutex for this pair: serializes the create section across processes.
        await lockPhoneKey(tx, 'player', `thread:${a}:${b}`);

        const [existing] = await tx
          .select()
          .from(phoneThreads)
          .where(and(eq(phoneThreads.playerAId, a), eq(phoneThreads.playerBId, b)))
          .limit(1);
        if (existing) {
          if (hooks.replaceThreadId !== existing.discordThreadId) {
            return { thread: existing, created: false };
          }
          await tx.delete(phoneThreads).where(eq(phoneThreads.id, existing.id));
        }

        const discordThreadId = await hooks.createThread([a, b]);
        if (!discordThreadId) return { thread: null, created: false };
        createdDiscordThreadId = discordThreadId;

        const [row] = await tx
          .insert(phoneThreads)
          .values({ playerAId: a, playerBId: b, discordThreadId })
          .returning();
        return { thread: row, created: true };
      });
    } catch (err) {
      if (isUniqueViolation(err) && createdDiscordThreadId) {
        // Lost the race (pair index or discord_thread_id index). The failed INSERT aborts
        // the transaction on Postgres, so cleanup + winner lookup must happen after rollback.
        if (hooks.onOrphan) {
          try {
            await hooks.onOrphan(createdDiscordThreadId);
          } catch (cleanupErr) {
            console.error('[phoneService] failed to delete orphaned phone thread:', cleanupErr);
          }
        }
        const [row] = await this.db
          .select()
          .from(phoneThreads)
          .where(and(eq(phoneThreads.playerAId, a), eq(phoneThreads.playerBId, b)))
          .limit(1);
        return { thread: row ?? null, created: false };
      }
      throw err;
    }
  }

  // ----------------------------------------------------------
  // Taps (staff-only)
  // ----------------------------------------------------------

  async setTap(input: SetTapInput, viewer: PhoneViewer): Promise<PhoneTap> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can set wiretaps.');
    }

    // Refuse taps with no destination. Without `mirrorChannelId` (or env fallback) AND no
    // `mirrorDiscordUserId`, every delivery would silently log "no tap target configured" —
    // staff would think the tap is live while nothing is being recorded.
    const hasChannel = Boolean(input.mirrorChannelId);
    const hasUser = Boolean(input.mirrorDiscordUserId);
    const hasFallback = Boolean(process.env.PHONE_TAP_CHANNEL_ID?.trim());
    if (!hasChannel && !hasUser && !hasFallback) {
      throw new PhoneServiceError(
        'invalid_state',
        'Tap requires a mirror destination: pass `mirror-channel`, `mirror-user`, or configure `PHONE_TAP_CHANNEL_ID`.',
      );
    }

    return this.db.transaction(async (tx) => {
      await lockPhoneKey(tx, 'number', input.targetNumberId);
      const [target] = await tx
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, input.targetNumberId))
        .for('update')
        .limit(1);
      if (!target) {
        throw new PhoneServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
      }
      // M3: a retired number id still resolves through the FK, but a tap on it would silently
      // never fire (no call routes through an inactive number) while showing live in tap-list.
      // Refuse it at the boundary rather than create a dead tap.
      if (!target.isActive) {
        throw new PhoneServiceError(
          'invalid_state',
          'That number has been retired — taps on inactive numbers never fire.',
        );
      }

      let row: PhoneTap;
      try {
        [row] = await tx
          .insert(phoneTaps)
          .values({
            targetNumberId: input.targetNumberId,
            createdById: input.createdById,
            reason: input.reason ?? null,
            mirrorChannelId: input.mirrorChannelId ?? null,
            mirrorDiscordUserId: input.mirrorDiscordUserId ?? null,
          })
          .returning();
      } catch (err) {
        // H2: `phone_taps_active_target_unique` rejects a second active tap on the same
        // number — surface it as a friendly refusal instead of a raw 23505.
        if (isUniqueViolation(err)) {
          throw new PhoneServiceError(
            'invalid_state',
            'This number is already tapped. Revoke the existing wiretap before setting a new one.',
          );
        }
        throw err;
      }
      await tx.insert(phoneTapAuditLog).values({
        tapId: row.id,
        actorId: input.createdById,
        action: 'created',
        // Denormalize the tap configuration so the audit row survives any future deletion or
        // rewrite of the live phoneTaps row.
        targetNumberId: input.targetNumberId,
        targetNumberNormalized: target.numberNormalized,
        mirrorChannelId: input.mirrorChannelId ?? null,
        mirrorDiscordUserId: input.mirrorDiscordUserId ?? null,
        notes: input.reason ?? null,
      });
      return row;
    });
  }

  /**
   * Revoke a tap. M4: the active-state check is folded into the UPDATE's WHERE
   * (`is_active = true`) and runs inside the transaction with `RETURNING`. Two concurrent
   * revokes can no longer both pass an out-of-txn `tap.isActive` read and both write a
   * `revoked` audit row — exactly one UPDATE flips the row and only that caller audits.
   */
  async revokeTap(tapId: string, actorId: string, viewer: PhoneViewer, notes?: string): Promise<void> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can revoke wiretaps.');
    }
    await this.db.transaction(async (tx) => {
      const [tap] = await tx
        .update(phoneTaps)
        .set({ isActive: false, revokedAt: new Date(), revokedById: actorId })
        .where(and(eq(phoneTaps.id, tapId), eq(phoneTaps.isActive, true)))
        .returning();
      // No row updated → the tap was missing or already revoked (possibly by a concurrent
      // revoke that won the race). Either way, this caller does not write an audit row.
      if (!tap) {
        throw new PhoneServiceError('not_found', 'Wiretap not found or already revoked.');
      }
      const [target] = await tx
        .select({ numberNormalized: phoneNumbers.numberNormalized })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, tap.targetNumberId))
        .limit(1);
      await tx.insert(phoneTapAuditLog).values({
        tapId,
        actorId,
        action: 'revoked',
        targetNumberId: tap.targetNumberId,
        targetNumberNormalized: target?.numberNormalized ?? null,
        mirrorChannelId: tap.mirrorChannelId,
        mirrorDiscordUserId: tap.mirrorDiscordUserId,
        notes: notes ?? null,
      });
    });
  }

  async listTaps(viewer: PhoneViewer, opts: { activeOnly?: boolean } = {}): Promise<PhoneTap[]> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can list wiretaps.');
    }
    const conditions: SQL[] = [];
    if (opts.activeOnly ?? true) conditions.push(eq(phoneTaps.isActive, true));
    return this.db
      .select()
      .from(phoneTaps)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(phoneTaps.createdAt));
  }

  async getActiveTapsForNumbers(numberIds: string[]): Promise<PhoneTap[]> {
    if (!numberIds.length) return [];
    return this.db
      .select()
      .from(phoneTaps)
      .where(and(inArray(phoneTaps.targetNumberId, numberIds), eq(phoneTaps.isActive, true)));
  }

  /**
   * Cheap point check that a tap is still active. Used by the relay between snapshotting
   * the active-tap list and posting each delivery: a concurrent `revokeTap` /
   * `autoRevokeBrokenTap` between the list lookup and the per-tap fan-out should not produce
   * a final mirror copy to the now-revoked destination.
   */
  async isTapActive(tapId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ isActive: phoneTaps.isActive })
      .from(phoneTaps)
      .where(eq(phoneTaps.id, tapId))
      .limit(1);
    return Boolean(row?.isActive);
  }

  /**
   * Insert a tap delivery record outright. Retained for callers that did not pre-create a
   * placeholder (e.g. a reconciliation job). The H1 hot path uses `recordMessage` placeholders
   * + `completeTapDelivery` instead, so the audit row exists before the Discord send is even
   * attempted.
   */
  async recordTapDelivery(
    messageId: string,
    tapId: string,
    result: { mirrorMessageId?: string | null; error?: string | null },
  ): Promise<void> {
    await this.db.insert(phoneMessageTapDeliveries).values({
      messageId,
      tapId,
      mirrorMessageId: result.mirrorMessageId ?? null,
      deliveredAt: result.error ? null : new Date(),
      error: result.error ? result.error.slice(0, 500) : null,
    });
  }

  /**
   * Fill in a placeholder `phone_message_tap_deliveries` row (created inside
   * `recordMessage`'s transaction) with the Discord send result. Keyed on the delivery row
   * id, so a crash-and-retry can re-run this idempotently against the same row instead of
   * inserting a duplicate.
   */
  async completeTapDelivery(
    deliveryId: string,
    result: { mirrorMessageId?: string | null; error?: string | null },
  ): Promise<void> {
    await this.db
      .update(phoneMessageTapDeliveries)
      .set({
        mirrorMessageId: result.mirrorMessageId ?? null,
        deliveredAt: result.error ? null : new Date(),
        error: result.error ? result.error.slice(0, 500) : null,
      })
      .where(eq(phoneMessageTapDeliveries.id, deliveryId));
  }

  /**
   * Count consecutive failed deliveries on the most recent N attempts for a tap. Used by
   * the relay circuit breaker — if every recent attempt has errored, the tap is broken and
   * should be auto-revoked rather than spam Discord with re-attempts.
   *
   * "Consecutive failures from the tail" means: walk the most recent N delivery rows in
   * reverse-chronological order; count how many leading ones had a non-null `error`.
   */
  async countTrailingTapFailures(tapId: string, limit = PHONE_TAP_FAILURE_THRESHOLD): Promise<number> {
    const rows = await this.db
      .select({ error: phoneMessageTapDeliveries.error })
      .from(phoneMessageTapDeliveries)
      .where(eq(phoneMessageTapDeliveries.tapId, tapId))
      .orderBy(desc(phoneMessageTapDeliveries.createdAt))
      .limit(limit);
    let consecutive = 0;
    for (const row of rows) {
      if (row.error) consecutive++;
      else break;
    }
    return consecutive;
  }

  /**
   * Auto-revoke a tap that the circuit breaker has determined is broken. Writes an audit
   * row with action `orphaned_target_deactivated` so staff can see why it disappeared.
   * The `actorId` is the tap's creator (we have no other system actor to attribute to).
   */
  async autoRevokeBrokenTap(tapId: string, notes: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [tap] = await tx
        .update(phoneTaps)
        .set({ isActive: false, revokedAt: new Date(), revokedById: sql`${phoneTaps.createdById}` })
        .where(and(eq(phoneTaps.id, tapId), eq(phoneTaps.isActive, true)))
        .returning();
      if (!tap) return;
      const [target] = await tx
        .select({ numberNormalized: phoneNumbers.numberNormalized })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, tap.targetNumberId))
        .limit(1);
      await tx.insert(phoneTapAuditLog).values({
        tapId,
        actorId: tap.createdById,
        action: 'orphaned_target_deactivated',
        targetNumberId: tap.targetNumberId,
        targetNumberNormalized: target?.numberNormalized ?? null,
        mirrorChannelId: tap.mirrorChannelId,
        mirrorDiscordUserId: tap.mirrorDiscordUserId,
        notes: notes.slice(0, 500),
      });
    });
  }

  // ----------------------------------------------------------
  // Reads (viewer-aware)
  // ----------------------------------------------------------

  async getCallHistory(
    targetPlayerId: string,
    viewer: PhoneViewer,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ calls: EnrichedPhoneCall[]; total: number }> {
    if (!viewer.isStaff && viewer.userId !== targetPlayerId) {
      throw new PhoneServiceError('forbidden', 'You can only view your own call history.');
    }
    const where = or(
      eq(phoneCalls.callerPlayerId, targetPlayerId),
      eq(phoneCalls.recipientPlayerId, targetPlayerId),
    );
    // Rows + count are independent; run them in parallel to halve wall-clock latency.
    const [rows, [{ value: total }]] = await Promise.all([
      this.db
        .select()
        .from(phoneCalls)
        .where(where)
        .orderBy(desc(phoneCalls.startedAt))
        .limit(opts.limit ?? 25)
        .offset(opts.offset ?? 0),
      this.db
        .select({ value: count() })
        .from(phoneCalls)
        .where(where),
    ]);

    // Enrich each row with caller/recipient summaries so list consumers (web, MCP, /phone
    // history) can render character names without a second round-trip.
    const playerIds = Array.from(new Set(rows.flatMap((r) => [r.callerPlayerId, r.recipientPlayerId])));
    const numberIds = Array.from(new Set(rows.flatMap((r) => [r.callerNumberId, r.recipientNumberId])));
    const [playerRows, numberRows] = playerIds.length
      ? await Promise.all([
        this.db
          .select({
            id: players.id,
            characterName: players.characterName,
            discordUsername: players.discordUsername,
            discordId: players.discordId,
          })
          .from(players)
          .where(inArray(players.id, playerIds)),
        this.db
          .select({ id: phoneNumbers.id, numberRaw: phoneNumbers.numberRaw })
          .from(phoneNumbers)
          .where(inArray(phoneNumbers.id, numberIds)),
      ])
      : [[], []];
    const playerMap = new Map(playerRows.map((p) => [p.id, p]));
    const numberMap = new Map(numberRows.map((n) => [n.id, n.numberRaw]));

    const calls: EnrichedPhoneCall[] = rows.map((row) => ({
      ...row,
      caller: {
        playerId: row.callerPlayerId,
        characterName: playerMap.get(row.callerPlayerId)?.characterName ?? null,
        discordUsername: playerMap.get(row.callerPlayerId)?.discordUsername ?? null,
        discordId: playerMap.get(row.callerPlayerId)?.discordId ?? null,
        numberRaw: numberMap.get(row.callerNumberId) ?? null,
      },
      recipient: {
        playerId: row.recipientPlayerId,
        characterName: playerMap.get(row.recipientPlayerId)?.characterName ?? null,
        discordUsername: playerMap.get(row.recipientPlayerId)?.discordUsername ?? null,
        discordId: playerMap.get(row.recipientPlayerId)?.discordId ?? null,
        numberRaw: numberMap.get(row.recipientNumberId) ?? null,
      },
    }));
    return { calls, total };
  }

  /**
   * Frozen transcript of a call.
   *
   * M6: returns `null` *both* when the call does not exist **and** when the viewer is not a
   * participant — the same not-found/not-yours collapse `getPlayerVotingRecord` uses. The
   * previous behaviour (null for missing, throw `forbidden` for real-but-private) let a
   * caller distinguish "no such call" from "exists, not yours", leaking call existence
   * through the differential error. Staff still see every call.
   *
   * H4: messages are ordered by `(createdAt, sequenceNo)` — `createdAt` is millisecond
   * resolution and two messages in the same millisecond would otherwise sort
   * non-deterministically; `sequenceNo` is the strictly-increasing tiebreaker.
   *
   * L5: a `viewer.isStaff` transcript additionally carries `taps` — the per-message
   * tap-delivery rows — so the wiretap audit trail is reconstructible from one read. The
   * non-staff shape is unchanged (no `taps` key).
   */
  async getCallTranscript(callId: string, viewer: PhoneViewer): Promise<{
    call: PhoneCall;
    messages: PhoneMessage[];
    taps?: PhoneMessageTapDelivery[];
  } | null> {
    const [call] = await this.db.select().from(phoneCalls).where(eq(phoneCalls.id, callId)).limit(1);
    if (!call) return null;
    if (!viewer.isStaff && viewer.userId !== call.callerPlayerId && viewer.userId !== call.recipientPlayerId) {
      // Not a participant: return null rather than throwing, so a non-participant cannot
      // tell "this call exists" from "this call does not exist".
      return null;
    }
    const messages = await this.db
      .select()
      .from(phoneMessages)
      .where(eq(phoneMessages.callId, callId))
      .orderBy(phoneMessages.createdAt, phoneMessages.sequenceNo);
    if (!viewer.isStaff) {
      return { call, messages };
    }
    // Staff-only: attach tap deliveries for every message in this call so the audit log is
    // reconstructible without a second query.
    const messageIds = messages.map((m) => m.id);
    const taps = messageIds.length
      ? await this.db
          .select()
          .from(phoneMessageTapDeliveries)
          .where(inArray(phoneMessageTapDeliveries.messageId, messageIds))
          .orderBy(phoneMessageTapDeliveries.createdAt)
      : [];
    return { call, messages, taps };
  }

  // ----------------------------------------------------------
  // Worker support
  // ----------------------------------------------------------

  /** Mark every ringing call past its expiry as missed. Returns the calls that were swept. */
  async expireRingingCalls(now: Date = new Date()): Promise<PhoneCall[]> {
    const rows = await this.db
      .update(phoneCalls)
      .set({ status: 'missed', endedAt: now, endedReason: 'ring_timeout' })
      .where(and(eq(phoneCalls.status, 'ringing'), sql`ring_expires_at IS NOT NULL AND ring_expires_at < ${now}`))
      .returning();
    return rows;
  }

  /**
   * Sweep `active` calls that have been alive past `maxAgeMs` with no recent activity.
   * Used by the bot startup recovery path: if the bot crashed mid-conversation, the call row
   * lingers as `active` forever. After enough time passes, we end it with `session_reset`
   * so the partial-unique-index slot frees and the participants stop typing into the void.
   *
   * Default 6h is well over any reasonable conversation length; tune via the option.
   */
  async sweepStrandedActiveCalls(opts: { now?: Date; maxAgeMs?: number } = {}): Promise<PhoneCall[]> {
    const now = opts.now ?? new Date();
    const maxAgeMs = opts.maxAgeMs ?? PHONE_STRANDED_CALL_MAX_AGE_MS;
    const cutoff = new Date(now.getTime() - maxAgeMs);
    // Single-column predicate hits `phone_calls_active_started_idx` (partial, WHERE status='active').
    // The 6h cutoff vastly exceeds any reasonable conversation; `answered_at` would only differ
    // from `started_at` by ring-timeout-bounded minutes, so the started_at check is sufficient.
    const rows = await this.db
      .update(phoneCalls)
      .set({ status: 'ended', endedAt: now, endedReason: 'session_reset' })
      .where(and(eq(phoneCalls.status, 'active'), sql`started_at < ${cutoff}`))
      .returning();
    return rows;
  }

  /**
   * Sweep crash-stranded tap-delivery placeholders. `recordMessage` pre-creates a
   * `phone_message_tap_deliveries` row per active tap inside the message transaction, and the
   * relay normally completes each via `completeTapDelivery`. If the relay crashes or throws
   * before reporting the send, the placeholder is left `delivered_at IS NULL AND error IS NULL`
   * indefinitely — on a staff transcript read that is indistinguishable from a send still in
   * flight. This marks any such row older than `maxAgeMs` with an explicit error so the audit
   * trail is unambiguous. The `error IS NULL` guard in the WHERE means a row a concurrent relay
   * completes mid-sweep is left untouched. Served by `phone_message_tap_deliveries_pending_idx`.
   */
  async sweepStaleTapDeliveries(
    opts: { now?: Date; maxAgeMs?: number } = {},
  ): Promise<PhoneMessageTapDelivery[]> {
    const now = opts.now ?? new Date();
    const maxAgeMs = opts.maxAgeMs ?? PHONE_STALE_TAP_DELIVERY_MAX_AGE_MS;
    const cutoff = new Date(now.getTime() - maxAgeMs);
    const rows = await this.db
      .update(phoneMessageTapDeliveries)
      .set({ error: 'relay crashed before delivery' })
      .where(
        and(
          isNull(phoneMessageTapDeliveries.deliveredAt),
          isNull(phoneMessageTapDeliveries.error),
          sql`created_at < ${cutoff}`,
        ),
      )
      .returning();
    return rows;
  }

  // ----------------------------------------------------------
  // Internals
  // ----------------------------------------------------------

  private async requireCall(callId: string): Promise<PhoneCall> {
    const [call] = await this.db.select().from(phoneCalls).where(eq(phoneCalls.id, callId)).limit(1);
    if (!call) throw new PhoneServiceError('not_found', 'Call not found.');
    return call;
  }
}

type PhoneLockScope = 'number' | 'player';

async function lockPhoneKeys(db: DbOrTx, keys: Array<[PhoneLockScope, string]>): Promise<void> {
  const uniqueKeys = Array.from(new Set(keys.map(([scope, id]) => `${scope}:${id}`))).sort();
  for (const key of uniqueKeys) {
    const [scope, id] = key.split(':', 2) as [PhoneLockScope, string];
    await lockPhoneKey(db, scope, id);
  }
}

async function lockPhoneKey(db: DbOrTx, scope: PhoneLockScope, id: string): Promise<void> {
  const executor = (db as { execute?: (query: SQL) => Promise<unknown> }).execute;
  if (typeof executor !== 'function') return;
  await executor.call(db, sql`SELECT pg_advisory_xact_lock(hashtext(${`phone:${scope}:${id}`}))`);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505');
}
