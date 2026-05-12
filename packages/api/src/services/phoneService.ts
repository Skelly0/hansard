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
  PHONE_NUMBERS_PER_PLAYER_LIMIT,
  PHONE_INELIGIBLE_DEAD,
  PHONE_INELIGIBLE_NO_CHARACTER,
  PHONE_ALREADY_ON_CALL,
  PHONE_NUMBER_TAKEN,
  PHONE_NUMBER_INVALID,
  PHONE_NUMBER_NOT_FOUND,
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

    const [player] = await this.db
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

    const [{ value: activeCount }] = await this.db
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
      const [row] = await this.db
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
  }

  async listMyNumbers(playerId: string): Promise<PhoneNumber[]> {
    return this.db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.playerId, playerId), eq(phoneNumbers.isActive, true)))
      .orderBy(desc(phoneNumbers.createdAt));
  }

  async deactivateNumber(numberId: string, actingPlayerId: string, viewer: PhoneViewer): Promise<void> {
    const [row] = await this.db
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

    // Refuse if the line is on an open call — caller would lose mid-call routing and the
    // recipient's UI would show a number that no longer exists. Staff can force-end first.
    const [openCall] = await this.db
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

    await this.db
      .update(phoneNumbers)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(eq(phoneNumbers.id, numberId));
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
    const [callerNumber] = await this.db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, input.callerNumberId))
      .limit(1);
    const [recipientNumber] = await this.db
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

    const [callerPlayer] = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordId: players.discordId,
        isAlive: players.isAlive,
      })
      .from(players)
      .where(eq(players.id, callerNumber.playerId))
      .limit(1);
    const [recipientPlayer] = await this.db
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

    const ringExpiresAt = new Date(Date.now() + PHONE_RING_TIMEOUT_MS);

    let call: PhoneCall;
    try {
      const [row] = await this.db
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
  }

  async answerCall(callId: string, actingPlayerId: string): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    if (call.recipientPlayerId !== actingPlayerId) {
      throw new PhoneServiceError('forbidden', 'Only the recipient can answer this call.');
    }
    if (call.status !== 'ringing') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }
    await this.assertActingPlayerAlive(actingPlayerId);

    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: 'active', answeredAt: new Date() })
      .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.status, 'ringing')))
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
   * Player-initiated hangup. The ended reason is **always derived from the actor's role** —
   * callers can't pass `'hangup_recipient'` and vice versa. System reasons (`relay_failed`,
   * `dm_closed`, ring expiry, force-end by staff) have dedicated methods below.
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

    const endedReason: 'hangup_caller' | 'hangup_recipient' | 'cancelled_by_caller' =
      call.status === 'ringing' && isCaller
        ? 'cancelled_by_caller'
        : isCaller
          ? 'hangup_caller'
          : 'hangup_recipient';

    const [updated] = await this.db
      .update(phoneCalls)
      .set({ status: 'ended', endedAt: new Date(), endedReason })
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

  async forceEndCall(callId: string, _actingStaffId: string, reason?: string): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }
    const [updated] = await this.db
      .update(phoneCalls)
      .set({
        status: 'ended',
        endedAt: new Date(),
        endedReason: reason ? `force_ended_by_staff:${reason.slice(0, 48)}` : 'force_ended_by_staff',
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

  /** Find the player's currently open call (ringing or active) for routing inbound DMs. */
  async findOpenCallForPlayer(playerId: string): Promise<PhoneCall | null> {
    const [row] = await this.db
      .select()
      .from(phoneCalls)
      .where(
        and(
          inArray(phoneCalls.status, ['ringing', 'active']),
          or(eq(phoneCalls.callerPlayerId, playerId), eq(phoneCalls.recipientPlayerId, playerId)),
        ),
      )
      .orderBy(desc(phoneCalls.startedAt))
      .limit(1);
    return row ?? null;
  }

  async getCallParticipants(callId: string): Promise<CallParticipants> {
    const call = await this.requireCall(callId);
    const [callerNumber] = await this.db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, call.callerNumberId))
      .limit(1);
    const [recipientNumber] = await this.db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, call.recipientNumberId))
      .limit(1);
    const [callerPlayer] = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordId: players.discordId,
        isAlive: players.isAlive,
      })
      .from(players)
      .where(eq(players.id, call.callerPlayerId))
      .limit(1);
    const [recipientPlayer] = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordId: players.discordId,
        isAlive: players.isAlive,
      })
      .from(players)
      .where(eq(players.id, call.recipientPlayerId))
      .limit(1);

    if (!callerNumber || !recipientNumber || !callerPlayer || !recipientPlayer) {
      throw new PhoneServiceError('not_found', 'Call participants no longer exist.');
    }
    return { call, callerNumber, recipientNumber, callerPlayer, recipientPlayer };
  }

  // ----------------------------------------------------------
  // Messages
  // ----------------------------------------------------------

  async recordMessage(input: RecordMessageInput): Promise<PhoneMessage> {
    const call = await this.requireCall(input.callId);
    if (call.status !== 'active') {
      throw new PhoneServiceError('invalid_state', `Call is ${call.status}, cannot record messages.`);
    }
    if (call.callerPlayerId !== input.senderPlayerId && call.recipientPlayerId !== input.senderPlayerId) {
      throw new PhoneServiceError('forbidden', 'You are not in this call.');
    }
    const [sender] = await this.db
      .select({ isAlive: players.isAlive })
      .from(players)
      .where(eq(players.id, input.senderPlayerId))
      .limit(1);
    if (!sender || !sender.isAlive) {
      throw new PhoneServiceError('dead', PHONE_INELIGIBLE_DEAD);
    }

    const [row] = await this.db
      .insert(phoneMessages)
      .values({
        callId: input.callId,
        senderPlayerId: input.senderPlayerId,
        content: input.content,
        senderDiscordMessageId: input.senderDiscordMessageId ?? null,
      })
      .returning();
    return row;
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
    throw new PhoneServiceError('invalid_state', 'Failed to persist phone thread.');
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
      error: result.error ?? null,
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
    const rows = await this.db
      .select()
      .from(phoneCalls)
      .where(where)
      .orderBy(desc(phoneCalls.startedAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);
    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(phoneCalls)
      .where(where);

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
    const maxAgeMs = opts.maxAgeMs ?? 6 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - maxAgeMs);
    const rows = await this.db
      .update(phoneCalls)
      .set({ status: 'ended', endedAt: now, endedReason: 'session_reset' })
      .where(and(eq(phoneCalls.status, 'active'), sql`answered_at < ${cutoff} OR started_at < ${cutoff}`))
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

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505');
}
