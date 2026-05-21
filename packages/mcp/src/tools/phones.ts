import { z } from 'zod';
import { PhoneService } from '@hansard/api/services/phoneService';
import { PhoneTextService } from '@hansard/api/services/phoneTextService';
import { jsonResult, safeHandler, type RegisterToolsFn } from './types.js';

function redactCallForParticipant<T extends Record<string, unknown>>(call: T): Omit<T, 'ringDiscordMessageId' | 'staffThreadId' | 'forceEndedById'> {
  const safeCall = { ...call };
  delete safeCall.ringDiscordMessageId;
  delete safeCall.staffThreadId;
  delete safeCall.forceEndedById;
  return safeCall;
}

function redactMessageForParticipant<T extends Record<string, unknown>>(
  message: T,
): Omit<T, 'senderDiscordMessageId' | 'recipientDiscordMessageId' | 'staffMirrorMessageId'> {
  const safeMessage = { ...message };
  delete safeMessage.senderDiscordMessageId;
  delete safeMessage.recipientDiscordMessageId;
  delete safeMessage.staffMirrorMessageId;
  return safeMessage;
}

function redactTextConversationForParticipant<T extends Record<string, unknown>>(
  conversation: T,
): Omit<T, 'staffThreadId'> {
  const safeConversation = { ...conversation };
  delete safeConversation.staffThreadId;
  return safeConversation;
}

function redactTextMessageForParticipant<T extends Record<string, unknown>>(
  message: T,
): Omit<T, 'senderDiscordMessageId' | 'staffMirrorMessageId'> {
  const safeMessage = { ...message };
  delete safeMessage.senderDiscordMessageId;
  delete safeMessage.staffMirrorMessageId;
  return safeMessage;
}

export const registerPhoneTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_my_phone_numbers',
    {
      description: "List the authenticated player's own active phone numbers.",
      inputSchema: {},
    },
    safeHandler(async () => {
      const session = await ctx.session.get();
      const svc = new PhoneService(ctx.db);
      const numbers = await svc.listMyNumbers(session.playerId);
      return jsonResult({ count: numbers.length, numbers });
    }),
  );

  server.registerTool(
    'get_phone_call_history',
    {
      description:
        "Get a player's call history. Non-staff sessions may only request their own; staff sessions may request any player.",
      inputSchema: {
        playerId: z.string().uuid().describe('Target player UUID.'),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args: { playerId: string; limit?: number; offset?: number }) => {
      const session = await ctx.session.get();
      const svc = new PhoneService(ctx.db);
      const { calls, total } = await svc.getCallHistory(
        args.playerId,
        { userId: session.playerId, isStaff: session.isStaff },
        { limit: args.limit, offset: args.offset },
      );
      return jsonResult({
        count: calls.length,
        total,
        calls: session.isStaff
          ? calls
          : calls.map((call) => redactCallForParticipant(call as unknown as Record<string, unknown>)),
      });
    }),
  );

  server.registerTool(
    'get_phone_call_transcript',
    {
      description:
        'Get the frozen transcript of a phone call. Participants may inspect their own calls; staff may inspect any.',
      inputSchema: {
        callId: z.string().uuid(),
      },
    },
    safeHandler(async (args: { callId: string }) => {
      const session = await ctx.session.get();
      const svc = new PhoneService(ctx.db);
      const result = await svc.getCallTranscript(args.callId, {
        userId: session.playerId,
        isStaff: session.isStaff,
      });
      if (!result) {
        return jsonResult({ call: null, messages: [] });
      }
      if (session.isStaff) return jsonResult(result);
      return jsonResult({
        call: redactCallForParticipant(result.call as unknown as Record<string, unknown>),
        messages: result.messages.map((message) =>
          redactMessageForParticipant(message as unknown as Record<string, unknown>),
        ),
      });
    }),
  );

  server.registerTool(
    'list_phone_text_conversations',
    {
      description:
        "List active phone text conversations. Non-staff sessions may only list their own; staff may provide playerId.",
      inputSchema: {
        playerId: z.string().uuid().optional(),
        includeArchived: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    safeHandler(async (args: { playerId?: string; includeArchived?: boolean; limit?: number }) => {
      const session = await ctx.session.get();
      const targetPlayerId = args.playerId ?? session.playerId;
      if (!session.isStaff && targetPlayerId !== session.playerId) {
        return jsonResult({ count: 0, conversations: [] });
      }
      const svc = new PhoneTextService(ctx.db);
      const conversations = await svc.listConversationsForPlayer(targetPlayerId, {
        includeArchived: args.includeArchived,
        limit: args.limit,
      });
      return jsonResult({
        count: conversations.length,
        conversations: session.isStaff
          ? conversations
          : conversations.map((context) => ({
              ...context,
              conversation: redactTextConversationForParticipant(
                context.conversation as unknown as Record<string, unknown>,
              ),
            })),
      });
    }),
  );

  server.registerTool(
    'get_phone_text_transcript',
    {
      description:
        'Get the frozen transcript of a phone text conversation. Participants may inspect their own conversations; staff may inspect any.',
      inputSchema: {
        conversationId: z.string().uuid(),
      },
    },
    safeHandler(async (args: { conversationId: string }) => {
      const session = await ctx.session.get();
      const svc = new PhoneTextService(ctx.db);
      const result = await svc.getConversationTranscript(args.conversationId, {
        userId: session.playerId,
        isStaff: session.isStaff,
      });
      if (!result) {
        return jsonResult({ conversation: null, messages: [] });
      }
      if (session.isStaff) return jsonResult(result);
      return jsonResult({
        conversation: redactTextConversationForParticipant(
          result.conversation as unknown as Record<string, unknown>,
        ),
        messages: result.messages.map((message) =>
          redactTextMessageForParticipant(message as unknown as Record<string, unknown>),
        ),
      });
    }),
  );
};
