import { z } from 'zod';
import { getOffice, listOffices } from '@hansard/api/services/officeService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerOfficeTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_offices',
    {
      description: 'List active offices with their current holders. Includes tier, permissions, faction.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const offices = await listOffices(ctx.db);
      return jsonResult({ count: offices.length, offices });
    }),
  );

  server.registerTool(
    'get_office',
    {
      description: 'Fetch one office by ID, including current holders and full holder history.',
      inputSchema: { id: z.string().uuid() },
    },
    safeHandler(async ({ id }) => {
      const office = await getOffice(ctx.db, id);
      if (!office) return errorResult(`No office with id ${id}.`);
      return jsonResult(office);
    }),
  );
};
