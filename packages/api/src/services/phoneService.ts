import { and, desc, eq, inArray, or, sql, count, type SQL } from 'drizzle-orm';
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
  | 'not_in_call'
  | 'recipient_dead'
  | 'self_call'
  | 'forbidden'
  | 'not_found'
  | 'limit_reached'
  | 'invalid_state';

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
            numberRaw: input.numberRaw.trim(),
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

  async answerCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    if (call.recipientPlayerId !== actingPlayerId) {
      throw new PhoneServiceError('forbidden', 'Only the recipient can answer this call.');
    }
    if (call.status !== 'ringing') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }
    const now = new Date();
    if (call.ringExpiresAt && call.ringExpiresAt <= now) {
      await this.db
        .update(phoneCalls)
        .set({ status: 'missed', endedAt: now, endedReason: 'ring_timeout' })
        .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing'), sql`ring_expires_at <= ${now}`));
      throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
    }
    await this.assertActingPlayerAlive(actingPlayerId);

    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: 'active', answeredAt: now })
      .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing'), sql`(ring_expires_at IS NULL OR ring_expires_at > ${now})`))
      .returning();

    if (!updated) {
      throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
    }
    return updated;
  }

  async declineCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    if (call.recipientPlayerId !== actingPlayerId) {
      throw new PhoneServiceError('forbidden', 'Only the recipient can decline this call.');
    }
    if (call.status !== 'ringing') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }
    await this.assertActingPlayerAlive(actingPlayerId);

    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: 'declined', endedAt: new Date(), endedReason: 'declined_by_recipient' })
      .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing')))
      .returning();

    if (!updated) {
      throw new PhoneServiceError('invalid_state', 'Call is no longer ringing.');
    }
    return updated;
  }

  private async assertActingPlayerAlive(playerId: string): Promise<void> {
    const [row] = await this.db
      .select({ isAlive: players.isAlive })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    if (!row || !row.isAlive) {
      throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
    }
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
   */
  async forceEndCall(callId: string, actingStaffId: string, reason?: string): Promise<PhoneCall> {
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
   */
  async recordMessage(input: RecordMessageInput): Promise<PhoneMessage> {
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
      return row;
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

    const [target] = await this.db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, input.targetNumberId))
      .limit(1);
    if (!target) {
      throw new PhoneServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
    }

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(phoneTaps)
        .values({
          targetNumberId: input.targetNumberId,
          createdById: input.createdById,
          reason: input.reason ?? null,
          mirrorChannelId: input.mirrorChannelId ?? null,
          mirrorDiscordUserId: input.mirrorDiscordUserId ?? null,
        })
        .returning();
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

  async revokeTap(tapId: string, actorId: string, viewer: PhoneViewer, notes?: string): Promise<void> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can revoke wiretaps.');
    }
    const [tap] = await this.db.select().from(phoneTaps).where(eq(phoneTaps.id, tapId)).limit(1);
    if (!tap || !tap.isActive) {
      throw new PhoneServiceError('not_found', 'Wiretap not found or already revoked.');
    }
    const [target] = await this.db
      .select({ numberNormalized: phoneNumbers.numberNormalized })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, tap.targetNumberId))
      .limit(1);

    await this.db.transaction(async (tx) => {
      await tx
        .update(phoneTaps)
        .set({ isActive: false, revokedAt: new Date(), revokedById: actorId })
        .where(eq(phoneTaps.id, tapId));
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
    const [tap] = await this.db.select().from(phoneTaps).where(eq(phoneTaps.id, tapId)).limit(1);
    if (!tap || !tap.isActive) return;
    const [target] = await this.db
      .select({ numberNormalized: phoneNumbers.numberNormalized })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, tap.targetNumberId))
      .limit(1);

    await this.db.transaction(async (tx) => {
      await tx
        .update(phoneTaps)
        .set({ isActive: false, revokedAt: new Date(), revokedById: tap.createdById })
        .where(eq(phoneTaps.id, tapId));
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

  async getCallTranscript(callId: string, viewer: PhoneViewer): Promise<{
    call: PhoneCall;
    messages: PhoneMessage[];
  } | null> {
    const [call] = await this.db.select().from(phoneCalls).where(eq(phoneCalls.id, callId)).limit(1);
    if (!call) return null;
    if (!viewer.isStaff && viewer.userId !== call.callerPlayerId && viewer.userId !== call.recipientPlayerId) {
      throw new PhoneServiceError('forbidden', 'You can only view transcripts of your own calls.');
    }
    const messages = await this.db
      .select()
      .from(phoneMessages)
      .where(eq(phoneMessages.callId, callId))
      .orderBy(phoneMessages.createdAt);
    return { call, messages };
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
