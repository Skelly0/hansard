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
  mirrorUserId?: string | null;
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

  async endCall(
    callId: string,
    actingPlayerId: string,
    reason: 'hangup_caller' | 'hangup_recipient' | 'force_ended_by_staff' | 'relay_failed' | 'dm_closed' = 'hangup_caller',
  ): Promise<PhoneCall> {
    const call = await this.requireCall(callId);
    const isCaller = call.callerPlayerId === actingPlayerId;
    const isRecipient = call.recipientPlayerId === actingPlayerId;
    if (!isCaller && !isRecipient && reason !== 'force_ended_by_staff' && reason !== 'relay_failed' && reason !== 'dm_closed') {
      throw new PhoneServiceError('forbidden', 'Only call participants can end this call.');
    }
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new PhoneServiceError('invalid_state', `Call is already ${call.status}.`);
    }

    const endedReason = reason === 'hangup_caller' && isRecipient ? 'hangup_recipient' : reason;
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
        endedReason: reason ? `force_ended_by_staff:${reason.slice(0, 32)}` : 'force_ended_by_staff',
      })
      .where(and(eq(phoneCalls.id, callId), inArray(phoneCalls.status, ['ringing', 'active'])))
      .returning();
    if (!updated) {
      throw new PhoneServiceError('invalid_state', 'Call already ended.');
    }
    return updated;
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
    const [target] = await this.db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, input.targetNumberId))
      .limit(1);
    if (!target) {
      throw new PhoneServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
    }
    const [row] = await this.db
      .insert(phoneTaps)
      .values({
        targetNumberId: input.targetNumberId,
        createdById: input.createdById,
        reason: input.reason ?? null,
        mirrorChannelId: input.mirrorChannelId ?? null,
        mirrorUserId: input.mirrorUserId ?? null,
      })
      .returning();
    await this.db.insert(phoneTapAuditLog).values({
      tapId: row.id,
      actorId: input.createdById,
      action: 'created',
      notes: input.reason ?? null,
    });
    return row;
  }

  async revokeTap(tapId: string, actorId: string, viewer: PhoneViewer, notes?: string): Promise<void> {
    if (!viewer.isStaff) {
      throw new PhoneServiceError('forbidden', 'Only staff can revoke wiretaps.');
    }
    const [tap] = await this.db.select().from(phoneTaps).where(eq(phoneTaps.id, tapId)).limit(1);
    if (!tap || !tap.isActive) {
      throw new PhoneServiceError('not_found', 'Wiretap not found or already revoked.');
    }
    await this.db
      .update(phoneTaps)
      .set({ isActive: false, revokedAt: new Date(), revokedById: actorId })
      .where(eq(phoneTaps.id, tapId));
    await this.db.insert(phoneTapAuditLog).values({
      tapId,
      actorId,
      action: 'revoked',
      notes: notes ?? null,
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
  ): Promise<{ calls: PhoneCall[]; total: number }> {
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
    return { calls: rows, total };
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
