import { z } from 'zod';
import { getOffice, listOffices } from '@hansard/api/services/officeService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

function withoutPermissionStrings<T extends { permissions?: unknown }>(office: T): Omit<T, 'permissions'> {
  const { permissions: _permissions, ...publicOffice } = office;
  return publicOffice;
}

export const registerOfficeTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_offices',
    {
      description: 'List active offices with their current holders. Staff sessions include raw permission strings.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const session = await ctx.session.get();
      const offices = await listOffices(ctx.db);
      const visibleOffices = session.isStaff ? offices : offices.map(withoutPermissionStrings);
      return jsonResult({ count: visibleOffices.length, offices: visibleOffices });
    }),
  );

  server.registerTool(
    'get_office',
    {
      description: 'Fetch one office by ID, including current holders and full holder history.',
      inputSchema: { id: z.string().uuid() },
    },
    safeHandler(async ({ id }) => {
      const session = await ctx.session.get();
      const office = await getOffice(ctx.db, id);
      if (!office) return errorResult(`No office with id ${id}.`);
      return jsonResult(session.isStaff ? office : withoutPermissionStrings(office));
    }),
  );
};
