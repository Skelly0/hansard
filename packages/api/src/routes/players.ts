import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import {
  createCharacter,
  getPlayer,
  getPlayerByDiscordId,
  listPlayers,
  countPlayers,
  updateCharacter,
  changeParty,
  leaveParty,
  getPlayerEvents,
  getPlayerHealth,
  getPlayerOfficeHistory,
  getPlayerVotingRecord,
  sanitizePlayerProfile,
  calculateStartingAgeFavourBonus,
  type CreateCharacterInput,
  type UpdateCharacterInput,
  type ListPlayersFilters,
  type PlayerEventFilters,
} from '../services/playerService.js';
import { listBills } from '../services/billService.js';
import { getHistory as getFavourHistory, getPlayerBalances } from '../services/favourService.js';
import { TicketService } from '../services/ticketService.js';

// ============================================================
// Route Parameter / Query Types
// ============================================================

interface IdParams {
  id: string;
}

interface ListPlayersQuery {
  factionId?: string;
  faction?: string;
  partyId?: string;
  party?: string;
  isActive?: string;
  active?: string;
  isStaff?: string;
  staff?: string;
  isAlive?: string;
  alive?: string;
  search?: string;
  limit?: string;
  offset?: string;
  page?: string;
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

function uniqueViolationContext(err: unknown): string | null {
  const error = err as { code?: string; message?: string; detail?: string; constraint?: string } | null;
  if (error?.code !== '23505') return null;
  return `${error.message ?? ''} ${error.detail ?? ''} ${error.constraint ?? ''}`;
}

function viewerFor(request: FastifyRequest) {
  return {
    userId: request.session.user!.id,
    isStaff: !!request.player?.isStaff,
  };
}

function canViewPrivatePlayerData(request: FastifyRequest, playerId: string): boolean {
  return !!request.player?.isStaff || request.session.user!.id === playerId;
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
      const factionId = q.factionId ?? q.faction;
      const partyId = q.partyId ?? q.party;
      const isActive = q.isActive ?? q.active;
      const isStaff = q.isStaff ?? q.staff;
      const isAlive = q.isAlive ?? q.alive;
      if (factionId) filters.factionId = factionId;
      if (partyId) filters.partyId = partyId;
      if (isActive !== undefined) filters.isActive = isActive === 'true';
      if (isStaff !== undefined) filters.isStaff = isStaff === 'true';
      if (isAlive !== undefined) filters.isAlive = isAlive === 'true';
      if (q.search) filters.search = q.search.slice(0, 100);
      if (q.limit) filters.limit = parseInt(q.limit, 10);
      if (q.offset) filters.offset = parseInt(q.offset, 10);
      else if (q.page && filters.limit) filters.offset = (Math.max(1, parseInt(q.page, 10)) - 1) * filters.limit;

      const [players, total] = await Promise.all([
        listPlayers(fastify.db, filters),
        countPlayers(fastify.db, filters),
      ]);
      const viewer = viewerFor(request);
      return { data: players.map((player) => sanitizePlayerProfile(player, viewer)), total };
    },
  );

  // ----------------------------------------------------------
  // GET /api/players/:id — full player dossier
  // ----------------------------------------------------------
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      const voteViewer = { userId: request.session.user!.id, isStaff: !!request.player?.isStaff };
      const canViewPrivate = canViewPrivatePlayerData(request, id);

      const [offices, billResult, votes, favourBalances, events] = await Promise.all([
        getPlayerOfficeHistory(fastify.db, id),
        listBills(fastify.db, { authorId: id, limit: 100 }),
        getPlayerVotingRecord(fastify.db, id, voteViewer),
        canViewPrivate ? getPlayerBalances(fastify.db, id) : Promise.resolve([]),
        getPlayerEvents(fastify.db, id, { limit: 50 }, voteViewer),
      ]);

      const response: Record<string, unknown> = {
        ...sanitizePlayerProfile(player, voteViewer),
        offices,
        bills: billResult.bills,
        votes,
        events,
      };

      if (canViewPrivate) {
        response.favours = favourBalances.map((balance) => ({
          categoryId: balance.categoryId,
          categoryName: balance.categoryName,
          balance: balance.balance,
        }));
      }

      return response;
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
        const duplicateContext = uniqueViolationContext(err);
        if (duplicateContext) {
          if (/discord/i.test(duplicateContext)) {
            return reply.status(409).send({
              error: 'A character already exists for this Discord account',
            });
          }

          if (/character[_ ]?name/i.test(duplicateContext)) {
            return reply.status(409).send({
              error: 'The character name is already taken',
            });
          }

          return reply.status(409).send({ error: 'Character conflicts with an existing player' });
        }

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

      if (id !== user.id && !request.player?.isStaff) {
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
        player: sanitizePlayerProfile(updated, viewerFor(request)),
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

      if (id !== user.id && !request.player?.isStaff) {
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
        return { player: sanitizePlayerProfile(updated, viewerFor(request)), message: 'Left party. Now independent.' };
      }

      try {
        const updated = await changeParty(fastify.db, id, partyId, triggeredById, {
          allowInviteOnly: !!request.player?.isStaff,
        });
        if (!updated) {
          return reply.status(404).send({ error: 'Player not found' });
        }
        return { player: sanitizePlayerProfile(updated, viewerFor(request)), message: 'Party changed.' };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Party not found')) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof Error && /invite-only/i.test(err.message)) {
          return reply.status(403).send({ error: err.message });
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

      const events = await getPlayerEvents(fastify.db, id, filters, viewerFor(request));
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
      if (!canViewPrivatePlayerData(request, request.params.id)) {
        return reply.status(403).send({ error: 'Cannot view another player’s health records' });
      }
      const health = await getPlayerHealth(fastify.db, request.params.id, viewerFor(request));
      if (!health) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      return health;
    },
  );

  // GET /api/players/:id/tickets — player's ticket history
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/tickets',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      const ticketService = new TicketService(fastify.db);
      const result = await ticketService.listTickets(
        { createdById: id, limit: 100 },
        { userId: request.session.user!.id, isStaff: !!request.player?.isStaff },
      );
      return { data: result.tickets, total: result.total };
    },
  );

  // GET /api/players/:id/votes — voting record
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/votes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      return getPlayerVotingRecord(fastify.db, id, {
        userId: request.session.user!.id,
        isStaff: !!request.player?.isStaff,
      });
    },
  );

  // GET /api/players/:id/offices — office history
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/offices',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      return getPlayerOfficeHistory(fastify.db, id);
    },
  );

  // GET /api/players/:id/bills — bills authored
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/bills',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      const result = await listBills(fastify.db, { authorId: id, limit: 100 });
      return result.bills;
    },
  );

  // GET /api/players/:id/favours — favour balances
  fastify.get<{ Params: IdParams }>(
    '/api/players/:id/favours',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const player = await getPlayer(fastify.db, id);
      if (!player) {
        return reply.status(404).send({ error: 'Player not found' });
      }
      if (!canViewPrivatePlayerData(request, id)) {
        return reply.status(403).send({ error: 'Cannot view another player’s favour history' });
      }
      const [balances, transactions] = await Promise.all([
        getPlayerBalances(fastify.db, id),
        getFavourHistory(fastify.db, id, { limit: 100 }),
      ]);
      return { playerId: id, balances, transactions };
    },
  );

}, { name: 'player-routes' });
