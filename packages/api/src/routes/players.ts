import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import {
  createCharacter,
  getPlayer,
  getPlayerByDiscordId,
  listPlayers,
  updateCharacter,
  changeParty,
  leaveParty,
  getPlayerEvents,
  getPlayerHealth,
  calculateStartingAgeFavourBonus,
  type CreateCharacterInput,
  type UpdateCharacterInput,
  type ListPlayersFilters,
  type PlayerEventFilters,
} from '../services/playerService.js';

// ============================================================
// Route Parameter / Query Types
// ============================================================

interface IdParams {
  id: string;
}

interface ListPlayersQuery {
  factionId?: string;
  partyId?: string;
  isActive?: string;
  isStaff?: string;
  isAlive?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

interface PlayerEventsQuery {
  eventType?: string;
  limit?: string;
  offset?: string;
}

interface ChangePartyBody {
  partyId: string;
  triggeredById?: string;
}

// ============================================================
// Plugin
// ============================================================

export default fp(async function playerRoutes(fastify: FastifyInstance) {
  // ----------------------------------------------------------
  // GET /api/players — list players with filters
  // ----------------------------------------------------------
  fastify.get<{ Querystring: ListPlayersQuery }>(
    '/api/players',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const q = request.query;

      const filters: ListPlayersFilters = {};
      if (q.factionId) filters.factionId = q.factionId;
      if (q.partyId) filters.partyId = q.partyId;
      if (q.isActive !== undefined) filters.isActive = q.isActive === 'true';
      if (q.isStaff !== undefined) filters.isStaff = q.isStaff === 'true';
      if (q.isAlive !== undefined) filters.isAlive = q.isAlive === 'true';
      if (q.search) filters.search = q.search.slice(0, 100);
      if (q.limit) filters.limit = parseInt(q.limit, 10);
      if (q.offset) filters.offset = parseInt(q.offset, 10);

      const players = await listPlayers(fastify.db, filters);
      return players;
    },
  );

  // ----------------------------------------------------------
  // GET /api/players/:id — full player dossier
  // ----------------------------------------------------------
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      return player;
    },
  );

  // ----------------------------------------------------------
  // POST /api/players/create — create a new character
  // ----------------------------------------------------------
  fastify.post<{ Body: CreateCharacterInput }>(
    '/api/players/create',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const body = request.body;

      // Validate required fields
      if (!body.discordId || !body.discordUsername || !body.characterName) {
        return reply.status(400).send({
          error: 'Missing required fields: discordId, discordUsername, characterName',
        });
      }

      if (!body.startingAge || body.startingAge < 18 || body.startingAge > 70) {
        return reply.status(400).send({
          error: 'startingAge must be between 18 and 70',
        });
      }

      // Check if player already exists
      const existing = await getPlayerByDiscordId(fastify.db, body.discordId);
      if (existing) {
        return reply.status(409).send({
          error: 'A character already exists for this Discord account',
          existingPlayerId: existing.id,
        });
      }

      try {
        const player = await createCharacter(fastify.db, body);
        const favourBonus = calculateStartingAgeFavourBonus(body.startingAge);

        return reply.status(201).send({
          player,
          favourBonus,
          message: favourBonus > 0
            ? `Character created! Starting age bonus: ${favourBonus} favours.`
            : 'Character created!',
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to create character');
        return reply.status(500).send({ error: 'Failed to create character' });
      }
    },
  );

  // ----------------------------------------------------------
  // PATCH /api/players/:id — update bio, portrait, name
  // ----------------------------------------------------------
  fastify.patch<{ Params: IdParams; Body: UpdateCharacterInput }>(
    '/api/players/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const user = request.session.user!;

      if (id !== user.id && !user.isStaff) {
        return reply.status(403).send({ error: 'Cannot edit another player’s character' });
      }

      if (!body.characterBio && !body.characterPortraitUrl && !body.characterName) {
        return reply.status(400).send({
          error: 'At least one field required: characterBio, characterPortraitUrl, characterName',
        });
      }

      const updated = await updateCharacter(fastify.db, id, body);
      if (!updated) {
        return reply.status(404).send({ error: 'Player not found' });
      }

      const nameChanged = body.characterName !== undefined;
      return {
        player: updated,
        nameChangeflagged: nameChanged,
        message: nameChanged
          ? 'Character updated. Name change has been flagged for staff review.'
          : 'Character updated.',
      };
    },
  );

  // ----------------------------------------------------------
  // POST /api/players/:id/party — change party
  // ----------------------------------------------------------
  fastify.post<{ Params: IdParams; Body: ChangePartyBody }>(
    '/api/players/:id/party',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const { partyId } = request.body;
      const user = request.session.user!;

      if (id !== user.id && !user.isStaff) {
        return reply.status(403).send({ error: 'Cannot change another player’s party' });
      }

      // Always derive triggeredById from session — never trust the client.
      const triggeredById = user.id;

      if (!partyId) {
        // If no partyId provided, treat as leaving party
        const updated = await leaveParty(fastify.db, id);
        if (!updated) {
          return reply.status(404).send({ error: 'Player not found' });
        }
        return { player: updated, message: 'Left party. Now independent.' };
      }

      try {
        const updated = await changeParty(fastify.db, id, partyId, triggeredById);
        if (!updated) {
          return reply.status(404).send({ error: 'Player not found' });
        }
        return { player: updated, message: 'Party changed.' };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Party not found')) {
          return reply.status(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ----------------------------------------------------------
  // GET /api/players/:id/events — player event log
  // ----------------------------------------------------------
  fastify.get<{ Params: IdParams; Querystring: PlayerEventsQuery }>(
    '/api/players/:id/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const q = request.query;

      // Verify player exists
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }

      const filters: PlayerEventFilters = {};
      if (q.eventType) filters.eventType = q.eventType;
      if (q.limit) filters.limit = parseInt(q.limit, 10);
      if (q.offset) filters.offset = parseInt(q.offset, 10);

      const events = await getPlayerEvents(fastify.db, id, filters);
      return events;
    },
  );

  // ----------------------------------------------------------
  // GET /api/players/:id/health — health status + ailment history
  // ----------------------------------------------------------
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/health',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const health = await getPlayerHealth(fastify.db, request.params.id);
      if (!health) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      return health;
    },
  );

  // ----------------------------------------------------------
  // STUBS — these return empty data until their services are built
  // ----------------------------------------------------------

  // GET /api/players/:id/tickets — player's ticket history
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/tickets',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      // TODO: Wire up ticket service
      return { playerId: request.params.id, tickets: [] };
    },
  );

  // GET /api/players/:id/votes — voting record
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/votes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      // TODO: Wire up voting service
      return { playerId: request.params.id, votes: [] };
    },
  );

  // GET /api/players/:id/offices — office history
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/offices',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      // TODO: Wire up office service
      return { playerId: request.params.id, offices: [] };
    },
  );

  // GET /api/players/:id/bills — bills authored
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/bills',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      // TODO: Wire up bills service
      return { playerId: request.params.id, bills: [] };
    },
  );

  // GET /api/players/:id/favours — favour balances
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/favours',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const player = await getPlayer(fastify.db, request.params.id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      // TODO: Wire up favours service
      return { playerId: request.params.id, balances: [], transactions: [] };
    },
  );

}, { name: 'player-routes' });
