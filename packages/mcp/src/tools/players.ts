import { z } from 'zod';
import { getPlayer, listPlayers, sanitizePlayerProfile } from '@hansard/api/services/playerService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerPlayerTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'get_my_player',
    {
      description: 'Get the authenticated user\'s own player profile (character info, party, faction, age, health, staff status).',
      inputSchema: {},
    },
    safeHandler(async () => {
      const session = await ctx.session.get();
      const player = await getPlayer(ctx.db, session.playerId);
      if (!player) return errorResult('Your player record was not found.');
      return jsonResult(sanitizePlayerProfile(player, {
        userId: session.playerId,
        isStaff: session.isStaff,
      }));
    }),
  );

  server.registerTool(
    'get_player',
    {
      description: 'Get a player profile by their internal UUID. Returns character details, party/faction, age, health, and staff flags.',
      inputSchema: {
        id: z.string().uuid().describe('Internal player UUID (not Discord snowflake).'),
      },
    },
    safeHandler(async ({ id }) => {
      const session = await ctx.session.get();
      const player = await getPlayer(ctx.db, id);
      if (!player) return errorResult(`No player found with id ${id}.`);
      return jsonResult(sanitizePlayerProfile(player, {
        userId: session.playerId,
        isStaff: session.isStaff,
      }));
    }),
  );

  server.registerTool(
    'list_players',
    {
      description: 'List players with optional filters. Useful for finding characters by name, by party, or by faction.',
      inputSchema: {
        search: z.string().optional().describe('Case-insensitive substring on character name or Discord username.'),
        partyId: z.string().uuid().optional(),
        factionId: z.string().uuid().optional(),
        isAlive: z.boolean().optional().describe('Default: include all. Set true to exclude dead characters.'),
        isActive: z.boolean().optional(),
        isStaff: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 100.'),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args) => {
      const session = await ctx.session.get();
      const players = await listPlayers(ctx.db, args);
      return jsonResult({
        count: players.length,
        players: players.map((player) => sanitizePlayerProfile(player, {
          userId: session.playerId,
          isStaff: session.isStaff,
        })),
      });
    }),
  );
};
