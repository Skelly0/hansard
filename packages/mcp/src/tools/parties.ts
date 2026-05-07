import { z } from 'zod';
import { getParties, getPartyById } from '@hansard/api/services/partyService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerPartyTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_parties',
    {
      description: 'List parties with member counts, faction, and current leader.',
      inputSchema: {
        includeInactive: z.boolean().optional().describe('Include dissolved parties. Default: false.'),
      },
    },
    safeHandler(async ({ includeInactive }) => {
      const parties = await getParties(ctx.db, { includeInactive });
      return jsonResult({ count: parties.length, parties });
    }),
  );

  server.registerTool(
    'get_party',
    {
      description: 'Fetch a party by ID, including its full member roster and leader info.',
      inputSchema: { id: z.string().uuid() },
    },
    safeHandler(async ({ id }) => {
      const party = await getPartyById(ctx.db, id);
      if (!party) return errorResult(`No party with id ${id}.`);
      return jsonResult(party);
    }),
  );
};
