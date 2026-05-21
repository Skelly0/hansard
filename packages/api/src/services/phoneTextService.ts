import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  phoneNumbers,
  phoneTextConversations,
  phoneTextMessages,
  phoneTextMessageDeliveries,
  phoneTextReplyStates,
  phoneTextMessageTapDeliveries,
  phoneTaps,
  players,
  type Database,
  type Transaction,
} from '@hansard/db';
import {
  PHONE_INELIGIBLE_DEAD,
  PHONE_INELIGIBLE_NO_CHARACTER,
  PHONE_NUMBER_NOT_FOUND,
  PHONE_STALE_TAP_DELIVERY_MAX_AGE_MS,
  PHONE_TEXT_ARCHIVED,
  PHONE_TEXT_DELIVERY_CLAIM_STALE_MS,
  PHONE_TEXT_MULTIPLE_CONVERSATIONS,
  PHONE_TEXT_NO_CONVERSATION,
} from '@hansard/shared';

export type PhoneTextConversation = typeof phoneTextConversations.$inferSelect;
export type PhoneTextMessage = typeof phoneTextMessages.$inferSelect;
export type PhoneTextMessageDelivery = typeof phoneTextMessageDeliveries.$inferSelect;
export type PhoneTextMessageTapDelivery = typeof phoneTextMessageTapDeliveries.$inferSelect;
export type PhoneTextTap = typeof phoneTaps.$inferSelect;

export interface PhoneTextParticipant {
  playerId: string;
  numberId: string;
  numberRaw: string;
  numberNormalized: string;
  pseudonym: string | null;
  characterName: string | null;
  discordId: string | null;
  discordUsername: string | null;
}

export interface PhoneTextConversationContext {
  conversation: PhoneTextConversation;
  participant: PhoneTextParticipant;
  counterparty: PhoneTextParticipant;
}

export interface RecordedPhoneText {
  conversation: PhoneTextConversation;
  message: PhoneTextMessage;
  delivery: PhoneTextMessageDelivery;
  tapDeliveries: PhoneTextMessageTapDelivery[];
  sender: PhoneTextParticipant;
  recipient: PhoneTextParticipant;
}

export interface QueuedPhoneTextDelivery {
  conversation: PhoneTextConversation;
  message: PhoneTextMessage;
  delivery: PhoneTextMessageDelivery;
  sender: PhoneTextParticipant;
  recipient: PhoneTextParticipant;
}

export type PhoneTextReplyResolution =
  | { status: 'selected' | 'sole'; context: PhoneTextConversationContext }
  | { status: 'multiple'; conversations: PhoneTextConversationContext[] }
  | { status: 'none' };

export interface PhoneTextViewer {
  userId: string;
  isStaff: boolean;
}

export interface RecordPhoneTextInput {
  senderPlayerId: string;
  senderNumberId: string;
  recipientNumberId: string;
  content: string;
  senderDiscordMessageId?: string | null;
}

export interface RecordPhoneTextReplyInput {
  senderPlayerId: string;
  conversationId: string;
  content: string;
  senderDiscordMessageId?: string | null;
}

export type PhoneTextErrorCode =
  | 'archived'
  | 'dead'
  | 'forbidden'
  | 'invalid_state'
  | 'multiple_conversations'
  | 'no_character'
  | 'no_conversation'
  | 'not_found'
  | 'recipient_dead'
  | 'self_text';

type DbOrTx = Database | Transaction;
type PhoneTextLockScope = 'number' | 'pair' | 'reply';

export class PhoneTextServiceError extends Error {
  constructor(public code: PhoneTextErrorCode, message: string) {
    super(message);
    this.name = 'PhoneTextServiceError';
  }
}

export class PhoneTextService {
  constructor(private db: Database) {}

  async recordText(input: RecordPhoneTextInput): Promise<RecordedPhoneText> {
    return this.db.transaction(async (tx) => {
      const sender = await loadParticipantForNumber(tx, input.senderNumberId);
      if (!sender || !sender.isActive) {
        throw new PhoneTextServiceError('not_found', 'Your texting number is not active.');
      }
      if (sender.playerId !== input.senderPlayerId) {
        throw new PhoneTextServiceError('forbidden', 'You can only text from your own numbers.');
      }

      const recipient = await loadParticipantForNumber(tx, input.recipientNumberId);
      if (!recipient || !recipient.isActive) {
        throw new PhoneTextServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
      }
      if (recipient.playerId === sender.playerId) {
        throw new PhoneTextServiceError('self_text', 'You cannot text yourself.');
      }
      requireTextableParticipant(sender, false);
      requireTextableParticipant(recipient, true);

      const conversation = await this.findOrCreateConversationInTx(tx, sender, recipient);
      return this.recordTextInConversation(tx, {
        conversation,
        sender,
        recipient,
        content: input.content,
        senderDiscordMessageId: input.senderDiscordMessageId ?? null,
      });
    });
  }

  async recordReply(input: RecordPhoneTextReplyInput): Promise<RecordedPhoneText> {
    return this.db.transaction(async (tx) => {
      const conversation = await this.requireActiveConversationForPlayer(tx, input.conversationId, input.senderPlayerId);
      const senderNumberId = conversation.playerAId === input.senderPlayerId
        ? conversation.numberAId
        : conversation.numberBId;
      const recipientPlayerId = conversation.playerAId === input.senderPlayerId
        ? conversation.playerBId
        : conversation.playerAId;
      const recipientNumberId = conversation.playerAId === input.senderPlayerId
        ? conversation.numberBId
        : conversation.numberAId;
      const sender = await loadParticipantForPlayerAndNumber(tx, input.senderPlayerId, senderNumberId);
      const recipient = await loadParticipantForPlayerAndNumber(tx, recipientPlayerId, recipientNumberId);
      requireTextableParticipant(sender, false);
      requireTextableParticipant(recipient, true);
      return this.recordTextInConversation(tx, {
        conversation,
        sender,
        recipient,
        content: input.content,
        senderDiscordMessageId: input.senderDiscordMessageId ?? null,
      });
    });
  }

  async findOrCreateConversation(
    senderNumberId: string,
    recipientNumberId: string,
  ): Promise<PhoneTextConversation> {
    return this.db.transaction(async (tx) => {
      const sender = await loadParticipantForNumber(tx, senderNumberId);
      const recipient = await loadParticipantForNumber(tx, recipientNumberId);
      if (!sender || !sender.isActive || !recipient || !recipient.isActive) {
        throw new PhoneTextServiceError('not_found', PHONE_NUMBER_NOT_FOUND);
      }
      if (sender.playerId === recipient.playerId) {
        throw new PhoneTextServiceError('self_text', 'You cannot text yourself.');
      }
      return this.findOrCreateConversationInTx(tx, sender, recipient);
    });
  }

  async setReplyConversation(playerId: string, conversationId: string): Promise<PhoneTextConversationContext> {
    return this.db.transaction(async (tx) => {
      const conversation = await this.requireActiveConversationForPlayer(tx, conversationId, playerId);
      const context = await hydrateConversationForPlayer(tx, conversation, playerId);
      await setReplyConversationInTx(tx, playerId, conversationId);
      return context;
    });
  }

  async clearReplyConversationForPlayer(playerId: string, conversationId?: string): Promise<void> {
    if (conversationId) {
      await this.db
        .delete(phoneTextReplyStates)
        .where(and(
          eq(phoneTextReplyStates.playerId, playerId),
          eq(phoneTextReplyStates.conversationId, conversationId),
        ));
      return;
    }
    await this.db.delete(phoneTextReplyStates).where(eq(phoneTextReplyStates.playerId, playerId));
  }

  async clearReplyConversationForConversation(conversationId: string): Promise<void> {
    await this.db
      .delete(phoneTextReplyStates)
      .where(eq(phoneTextReplyStates.conversationId, conversationId));
  }

  async resolveReplyConversation(playerId: string): Promise<PhoneTextReplyResolution> {
    const [state] = await this.db
      .select()
      .from(phoneTextReplyStates)
      .where(eq(phoneTextReplyStates.playerId, playerId))
      .limit(1);

    if (state?.conversationId) {
      const selected = await this.findConversationForPlayer(state.conversationId, playerId);
      if (selected?.conversation.status === 'active') {
        return { status: 'selected', context: selected };
      }
    }

    const active = await this.listConversationsForPlayer(playerId, { limit: 2 });
    if (active.length === 0) return { status: 'none' };
    if (active.length === 1) return { status: 'sole', context: active[0] };
    return { status: 'multiple', conversations: active };
  }

  async listConversationsForPlayer(
    playerId: string,
    opts: { limit?: number; includeArchived?: boolean } = {},
  ): Promise<PhoneTextConversationContext[]> {
    const where = and(
      or(
        eq(phoneTextConversations.playerAId, playerId),
        eq(phoneTextConversations.playerBId, playerId),
      ),
      opts.includeArchived ? undefined : eq(phoneTextConversations.status, 'active'),
    );
    const rows = await this.db
      .select()
      .from(phoneTextConversations)
      .where(where)
      .orderBy(desc(phoneTextConversations.lastMessageAt), desc(phoneTextConversations.createdAt))
      .limit(opts.limit ?? 25);
    const out: PhoneTextConversationContext[] = [];
    for (const row of rows) {
      out.push(await hydrateConversationForPlayer(this.db, row, playerId));
    }
    return out;
  }

  async archiveConversation(playerId: string, conversationId: string): Promise<PhoneTextConversation> {
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .update(phoneTextConversations)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(and(
          eq(phoneTextConversations.id, conversationId),
          eq(phoneTextConversations.status, 'active'),
          or(
            eq(phoneTextConversations.playerAId, playerId),
            eq(phoneTextConversations.playerBId, playerId),
          ),
        ))
        .returning();
      if (!conversation) {
        const existing = await this.findConversationForPlayer(conversationId, playerId);
        if (existing?.conversation.status === 'archived') {
          throw new PhoneTextServiceError('archived', PHONE_TEXT_ARCHIVED);
        }
        throw new PhoneTextServiceError('not_found', 'Text conversation not found.');
      }
      await tx
        .delete(phoneTextReplyStates)
        .where(eq(phoneTextReplyStates.conversationId, conversationId));
      return conversation;
    });
  }

  async setStaffThread(conversationId: string, discordThreadId: string): Promise<void> {
    await this.db
      .update(phoneTextConversations)
      .set({ staffThreadId: discordThreadId })
      .where(and(
        eq(phoneTextConversations.id, conversationId),
        isNull(phoneTextConversations.staffThreadId),
      ));
  }

  async updateMessageMirrorIds(
    messageId: string,
    ids: { staffMirrorMessageId?: string | null },
  ): Promise<void> {
    await this.db
      .update(phoneTextMessages)
      .set({ staffMirrorMessageId: ids.staffMirrorMessageId ?? null })
      .where(eq(phoneTextMessages.id, messageId));
  }

  async getQueuedDeliveriesForPlayer(playerId: string, limit = 25): Promise<QueuedPhoneTextDelivery[]> {
    const rows = await this.db
      .select({
        delivery: phoneTextMessageDeliveries,
        message: phoneTextMessages,
        conversation: phoneTextConversations,
      })
      .from(phoneTextMessageDeliveries)
      .innerJoin(phoneTextMessages, eq(phoneTextMessageDeliveries.messageId, phoneTextMessages.id))
      .innerJoin(phoneTextConversations, eq(phoneTextMessages.conversationId, phoneTextConversations.id))
      .where(and(
        eq(phoneTextMessageDeliveries.recipientPlayerId, playerId),
        eq(phoneTextMessageDeliveries.status, 'queued'),
        eq(phoneTextConversations.status, 'active'),
      ))
      .orderBy(asc(phoneTextMessageDeliveries.createdAt))
      .limit(limit);

    const out: QueuedPhoneTextDelivery[] = [];
    for (const row of rows) {
      const context = await hydrateConversationForPlayer(this.db, row.conversation, playerId);
      const sender = context.participant.playerId === row.message.senderPlayerId
        ? context.participant
        : context.counterparty;
      const recipient = sender.playerId === context.participant.playerId
        ? context.counterparty
        : context.participant;
      out.push({ ...row, sender, recipient });
    }
    return out;
  }

  async claimDeliveryForSend(deliveryId: string, now: Date = new Date()): Promise<PhoneTextMessageDelivery | null> {
    const [delivery] = await this.db
      .update(phoneTextMessageDeliveries)
      .set({ status: 'delivering', claimedAt: now, failureReason: null })
      .where(and(
        eq(phoneTextMessageDeliveries.id, deliveryId),
        eq(phoneTextMessageDeliveries.status, 'queued'),
      ))
      .returning();
    return delivery ?? null;
  }

  async markDeliveryDelivered(
    deliveryId: string,
    recipientDiscordMessageId: string | null,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db
      .update(phoneTextMessageDeliveries)
      .set({
        status: 'delivered',
        recipientDiscordMessageId,
        deliveredAt: now,
        claimedAt: null,
        failureReason: null,
      })
      .where(eq(phoneTextMessageDeliveries.id, deliveryId));
  }

  async markDeliveryFailed(deliveryId: string, reason: string): Promise<void> {
    await this.db
      .update(phoneTextMessageDeliveries)
      .set({
        status: 'failed',
        failureReason: reason.slice(0, 500),
        claimedAt: null,
      })
      .where(eq(phoneTextMessageDeliveries.id, deliveryId));
  }

  async releaseDeliveryClaim(deliveryId: string): Promise<void> {
    await this.db
      .update(phoneTextMessageDeliveries)
      .set({ status: 'queued', claimedAt: null })
      .where(and(
        eq(phoneTextMessageDeliveries.id, deliveryId),
        eq(phoneTextMessageDeliveries.status, 'delivering'),
      ));
  }

  async sweepStaleDeliveryClaims(
    opts: { now?: Date; maxAgeMs?: number } = {},
  ): Promise<PhoneTextMessageDelivery[]> {
    const now = opts.now ?? new Date();
    const maxAgeMs = opts.maxAgeMs ?? PHONE_TEXT_DELIVERY_CLAIM_STALE_MS;
    const cutoff = new Date(now.getTime() - maxAgeMs);
    return this.db
      .update(phoneTextMessageDeliveries)
      .set({ status: 'queued', claimedAt: null, failureReason: null })
      .where(and(
        eq(phoneTextMessageDeliveries.status, 'delivering'),
        isNotNull(phoneTextMessageDeliveries.claimedAt),
        lt(phoneTextMessageDeliveries.claimedAt, cutoff),
      ))
      .returning();
  }

  async completeTapDelivery(
    deliveryId: string,
    result: { mirrorMessageId?: string | null; error?: string | null },
  ): Promise<void> {
    await this.db
      .update(phoneTextMessageTapDeliveries)
      .set({
        mirrorMessageId: result.mirrorMessageId ?? null,
        deliveredAt: result.error ? null : new Date(),
        error: result.error ? result.error.slice(0, 500) : null,
      })
      .where(eq(phoneTextMessageTapDeliveries.id, deliveryId));
  }

  async isTapActive(tapId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: phoneTaps.id })
      .from(phoneTaps)
      .where(and(eq(phoneTaps.id, tapId), eq(phoneTaps.isActive, true)))
      .limit(1);
    return Boolean(row);
  }

  async getActiveTapsForNumbers(numberIds: string[]): Promise<PhoneTextTap[]> {
    const ids = Array.from(new Set(numberIds));
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(phoneTaps)
      .where(and(inArray(phoneTaps.targetNumberId, ids), eq(phoneTaps.isActive, true)));
  }

  async countTrailingTapFailures(tapId: string, limit = 5): Promise<number> {
    const rows = await this.db
      .select({ error: phoneTextMessageTapDeliveries.error })
      .from(phoneTextMessageTapDeliveries)
      .where(eq(phoneTextMessageTapDeliveries.tapId, tapId))
      .orderBy(desc(phoneTextMessageTapDeliveries.createdAt))
      .limit(limit);
    let consecutive = 0;
    for (const row of rows) {
      if (row.error) consecutive++;
      else break;
    }
    return consecutive;
  }

  async sweepStaleTapDeliveries(
    opts: { now?: Date; maxAgeMs?: number } = {},
  ): Promise<PhoneTextMessageTapDelivery[]> {
    const now = opts.now ?? new Date();
    const maxAgeMs = opts.maxAgeMs ?? PHONE_STALE_TAP_DELIVERY_MAX_AGE_MS;
    const cutoff = new Date(now.getTime() - maxAgeMs);
    return this.db
      .update(phoneTextMessageTapDeliveries)
      .set({ error: 'relay crashed before delivery' })
      .where(and(
        isNull(phoneTextMessageTapDeliveries.deliveredAt),
        isNull(phoneTextMessageTapDeliveries.error),
        lt(phoneTextMessageTapDeliveries.createdAt, cutoff),
      ))
      .returning();
  }

  async getConversationTranscript(
    conversationId: string,
    viewer: PhoneTextViewer,
  ): Promise<{
    conversation: PhoneTextConversation;
    messages: PhoneTextMessage[];
    taps?: PhoneTextMessageTapDelivery[];
  } | null> {
    const [conversation] = await this.db
      .select()
      .from(phoneTextConversations)
      .where(eq(phoneTextConversations.id, conversationId))
      .limit(1);
    if (!conversation) return null;
    if (
      !viewer.isStaff
      && viewer.userId !== conversation.playerAId
      && viewer.userId !== conversation.playerBId
    ) {
      return null;
    }

    const messages = await this.db
      .select()
      .from(phoneTextMessages)
      .where(eq(phoneTextMessages.conversationId, conversationId))
      .orderBy(asc(phoneTextMessages.createdAt), asc(phoneTextMessages.sequenceNo));

    if (!viewer.isStaff) return { conversation, messages };

    const messageIds = messages.map((message) => message.id);
    const taps = messageIds.length
      ? await this.db
          .select()
          .from(phoneTextMessageTapDeliveries)
          .where(inArray(phoneTextMessageTapDeliveries.messageId, messageIds))
          .orderBy(asc(phoneTextMessageTapDeliveries.createdAt))
      : [];
    return { conversation, messages, taps };
  }

  private async findOrCreateConversationInTx(
    tx: Transaction,
    first: LoadedPhoneTextParticipant,
    second: LoadedPhoneTextParticipant,
  ): Promise<PhoneTextConversation> {
    const pair = sortNumberPair(first, second);
    await lockPhoneTextKey(tx, 'pair', `${pair.numberAId}:${pair.numberBId}`);

    const existing = await findActiveConversationByPair(tx, pair.numberAId, pair.numberBId);
    if (existing) return existing;

    try {
      const [created] = await tx
        .insert(phoneTextConversations)
        .values({
          numberAId: pair.numberAId,
          numberBId: pair.numberBId,
          playerAId: pair.playerAId,
          playerBId: pair.playerBId,
        })
        .returning();
      return created;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await findActiveConversationByPair(tx, pair.numberAId, pair.numberBId);
      if (raced) return raced;
      throw err;
    }
  }

  private async recordTextInConversation(
    tx: Transaction,
    input: {
      conversation: PhoneTextConversation;
      sender: LoadedPhoneTextParticipant;
      recipient: LoadedPhoneTextParticipant;
      content: string;
      senderDiscordMessageId: string | null;
    },
  ): Promise<RecordedPhoneText> {
    const content = cleanTextContent(input.content);
    if (!content) {
      throw new PhoneTextServiceError('invalid_state', 'Text message cannot be blank.');
    }

    const now = new Date();
    const [message] = await tx
      .insert(phoneTextMessages)
      .values({
        conversationId: input.conversation.id,
        senderPlayerId: input.sender.playerId,
        senderNumberId: input.sender.numberId,
        content,
        senderDiscordMessageId: input.senderDiscordMessageId,
      })
      .returning();

    const [delivery] = await tx
      .insert(phoneTextMessageDeliveries)
      .values({
        messageId: message.id,
        recipientPlayerId: input.recipient.playerId,
        recipientNumberId: input.recipient.numberId,
        status: 'queued',
      })
      .returning();

    const taps = await tx
      .select()
      .from(phoneTaps)
      .where(and(
        inArray(phoneTaps.targetNumberId, [input.sender.numberId, input.recipient.numberId]),
        eq(phoneTaps.isActive, true),
      ));
    const tapDeliveries = taps.length
      ? await tx
          .insert(phoneTextMessageTapDeliveries)
          .values(taps.map((tap) => ({ messageId: message.id, tapId: tap.id })))
          .returning()
      : [];

    const [conversation] = await tx
      .update(phoneTextConversations)
      .set({ lastMessageAt: now })
      .where(eq(phoneTextConversations.id, input.conversation.id))
      .returning();

    await setReplyConversationInTx(tx, input.sender.playerId, input.conversation.id);

    return {
      conversation: conversation ?? input.conversation,
      message,
      delivery,
      tapDeliveries,
      sender: toPublicParticipant(input.sender),
      recipient: toPublicParticipant(input.recipient),
    };
  }

  private async requireActiveConversationForPlayer(
    db: DbOrTx,
    conversationId: string,
    playerId: string,
  ): Promise<PhoneTextConversation> {
    const [conversation] = await db
      .select()
      .from(phoneTextConversations)
      .where(eq(phoneTextConversations.id, conversationId))
      .limit(1);
    if (!conversation) throw new PhoneTextServiceError('not_found', 'Text conversation not found.');
    if (conversation.playerAId !== playerId && conversation.playerBId !== playerId) {
      throw new PhoneTextServiceError('forbidden', 'You are not in this text conversation.');
    }
    if (conversation.status !== 'active') {
      throw new PhoneTextServiceError('archived', PHONE_TEXT_ARCHIVED);
    }
    return conversation;
  }

  private async findConversationForPlayer(
    conversationId: string,
    playerId: string,
  ): Promise<PhoneTextConversationContext | null> {
    const [conversation] = await this.db
      .select()
      .from(phoneTextConversations)
      .where(eq(phoneTextConversations.id, conversationId))
      .limit(1);
    if (!conversation) return null;
    if (conversation.playerAId !== playerId && conversation.playerBId !== playerId) return null;
    return hydrateConversationForPlayer(this.db, conversation, playerId);
  }
}

interface LoadedPhoneTextParticipant extends PhoneTextParticipant {
  isActive: boolean;
  isAlive: boolean;
}

async function loadParticipantForNumber(db: DbOrTx, numberId: string): Promise<LoadedPhoneTextParticipant | null> {
  const [row] = await db
    .select({
      numberId: phoneNumbers.id,
      numberRaw: phoneNumbers.numberRaw,
      numberNormalized: phoneNumbers.numberNormalized,
      pseudonym: phoneNumbers.pseudonym,
      isActive: phoneNumbers.isActive,
      playerId: players.id,
      characterName: players.characterName,
      discordId: players.discordId,
      discordUsername: players.discordUsername,
      isAlive: players.isAlive,
    })
    .from(phoneNumbers)
    .innerJoin(players, eq(phoneNumbers.playerId, players.id))
    .where(eq(phoneNumbers.id, numberId))
    .limit(1);
  return row ?? null;
}

async function loadParticipantForPlayerAndNumber(
  db: DbOrTx,
  playerId: string,
  numberId: string,
): Promise<LoadedPhoneTextParticipant> {
  const participant = await loadParticipantForNumber(db, numberId);
  if (!participant || participant.playerId !== playerId) {
    throw new PhoneTextServiceError('not_found', 'Text conversation participant not found.');
  }
  return participant;
}

async function hydrateConversationForPlayer(
  db: DbOrTx,
  conversation: PhoneTextConversation,
  playerId: string,
): Promise<PhoneTextConversationContext> {
  if (conversation.playerAId !== playerId && conversation.playerBId !== playerId) {
    throw new PhoneTextServiceError('forbidden', 'You are not in this text conversation.');
  }
  const ownNumberId = conversation.playerAId === playerId ? conversation.numberAId : conversation.numberBId;
  const otherPlayerId = conversation.playerAId === playerId ? conversation.playerBId : conversation.playerAId;
  const otherNumberId = conversation.playerAId === playerId ? conversation.numberBId : conversation.numberAId;

  const participant = await loadParticipantForPlayerAndNumber(db, playerId, ownNumberId);
  const counterparty = await loadParticipantForPlayerAndNumber(db, otherPlayerId, otherNumberId);
  return {
    conversation,
    participant: toPublicParticipant(participant),
    counterparty: toPublicParticipant(counterparty),
  };
}

async function findActiveConversationByPair(
  db: DbOrTx,
  numberAId: string,
  numberBId: string,
): Promise<PhoneTextConversation | null> {
  const [conversation] = await db
    .select()
    .from(phoneTextConversations)
    .where(and(
      eq(phoneTextConversations.numberAId, numberAId),
      eq(phoneTextConversations.numberBId, numberBId),
      eq(phoneTextConversations.status, 'active'),
    ))
    .limit(1);
  return conversation ?? null;
}

async function setReplyConversationInTx(
  tx: Transaction,
  playerId: string,
  conversationId: string,
): Promise<void> {
  await lockPhoneTextKey(tx, 'reply', playerId);
  await tx
    .insert(phoneTextReplyStates)
    .values({ playerId, conversationId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: phoneTextReplyStates.playerId,
      set: { conversationId, updatedAt: new Date() },
    });
}

function requireTextableParticipant(participant: LoadedPhoneTextParticipant, recipient: boolean): void {
  if (!participant.characterName) {
    throw new PhoneTextServiceError(
      recipient ? 'not_found' : 'no_character',
      recipient ? PHONE_NUMBER_NOT_FOUND : PHONE_INELIGIBLE_NO_CHARACTER,
    );
  }
  if (!participant.isAlive) {
    throw new PhoneTextServiceError(recipient ? 'recipient_dead' : 'dead', PHONE_INELIGIBLE_DEAD);
  }
}

function cleanTextContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

function toPublicParticipant(participant: LoadedPhoneTextParticipant): PhoneTextParticipant {
  return {
    playerId: participant.playerId,
    numberId: participant.numberId,
    numberRaw: participant.numberRaw,
    numberNormalized: participant.numberNormalized,
    pseudonym: participant.pseudonym,
    characterName: participant.characterName,
    discordId: participant.discordId,
    discordUsername: participant.discordUsername,
  };
}

function sortNumberPair(
  first: { numberId: string; playerId: string },
  second: { numberId: string; playerId: string },
): {
  numberAId: string;
  numberBId: string;
  playerAId: string;
  playerBId: string;
} {
  // Drizzle/Postgres UUIDs are canonical lowercase strings; JS lexical ordering matches
  // Postgres uuid ordering for that representation.
  return first.numberId < second.numberId
    ? {
        numberAId: first.numberId,
        numberBId: second.numberId,
        playerAId: first.playerId,
        playerBId: second.playerId,
      }
    : {
        numberAId: second.numberId,
        numberBId: first.numberId,
        playerAId: second.playerId,
        playerBId: first.playerId,
      };
}

async function lockPhoneTextKey(db: DbOrTx, scope: PhoneTextLockScope, id: string): Promise<void> {
  const executor = (db as { execute?: (query: SQL) => Promise<unknown> }).execute;
  if (typeof executor !== 'function') return;
  await executor.call(db, sql`SELECT pg_advisory_xact_lock(hashtext(${`phone-text:${scope}:${id}`}))`);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505');
}

export function phoneTextReplyHintForResolution(resolution: PhoneTextReplyResolution): string | null {
  switch (resolution.status) {
    case 'none':
      return PHONE_TEXT_NO_CONVERSATION;
    case 'multiple':
      return PHONE_TEXT_MULTIPLE_CONVERSATIONS;
    default:
      return null;
  }
}
