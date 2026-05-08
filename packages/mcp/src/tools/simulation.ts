import { z } from 'zod';
import { getClock, getHistory } from '@hansard/api/services/simulationService';
import { jsonResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerSimulationTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'get_simulation_state',
    {
      description: 'Get the current simulation clock (tick, in-sim date, paused state) plus recent time-advance history.',
      inputSchema: {
        historyLimit: z.number().int().min(0).max(100).optional().describe('How many recent advances to include. Default 20.'),
      },
    },
    safeHandler(async ({ historyLimit }) => {
      const clock = await getClock(ctx.db);
      const history = await getHistory(ctx.db, historyLimit ?? 20);
      return jsonResult({ clock, history });
    }),
  );
};
