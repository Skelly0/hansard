import { z } from 'zod';
import { PhoneService } from '@hansard/api/services/phoneService';
import { jsonResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerPhoneTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_my_phone_numbers',
    {
      description: 'List the authenticated player\'s own active phone numbers.',
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
        'Get a player\'s call history. Non-staff sessions may only request their own; staff sessions may request any player.',
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
      return jsonResult({ count: calls.length, total, calls });
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
      return jsonResult(result);
    }),
  );
};
