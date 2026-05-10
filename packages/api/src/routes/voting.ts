import type { FastifyInstance } from 'fastify';
import '../plugins/db.js'; // ensure fastify.db type augmentation is available
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { VoteService } from '../services/voteService.js';
import { aggregatePermissionsForPlayer } from '../services/playerService.js';

/**
 * Voting / Election routes.
 *
 * Mirrors the scaffold spec:
 *   GET    /api/elections                   - List (filterable)
 *   GET    /api/elections/:id               - Details + candidates
 *   POST   /api/elections                   - Create
 *   PATCH  /api/elections/:id               - Update config
 *   POST   /api/elections/:id/open          - Open voting
 *   POST   /api/elections/:id/close         - Close voting
 *   POST   /api/elections/:id/tally         - Tally + auto-runoff
 *   GET    /api/elections/:id/results       - Results (sealed-aware)
 *   POST   /api/elections/:id/candidates    - Register candidate
 *   POST   /api/elections/:id/vote          - Cast ballot
 *   GET    /api/elections/:id/eligibility   - Can I vote?
 *   GET    /api/elections/:id/turnout       - Turnout stats
 *   POST   /api/elections/:id/npc-confirm   - NPC house result (staff)
 *   POST   /api/elections/:id/certify       - Certify (staff)
 *   POST   /api/elections/:id/create-runoff - Create runoff
 *   GET    /api/elections/:id/rounds        - All rounds
 */
export default async function votingRoutes(fastify: FastifyInstance) {
  // The VoteService needs a DB instance — in a real setup this comes from
  // the db plugin. For now we construct it lazily using the decorated db.
  const getService = () => {
    return new VoteService(fastify.db);
  };
  const getViewer = (request: { session: { user?: { id: string } }; player?: { isStaff?: boolean } }) => ({
    userId: request.session.user!.id,
    isStaff: !!request.player?.isStaff,
  });

  // ------------------------------------------------------------------
  // LIST elections
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections',
    { preHandler: [requireAuth] },
    async (request) => {
      const service = getService();
      const query = request.query as Record<string, string>;
      return service.listElections({
        status: query.status as any,
        scope: query.scope as any,
        type: query.type as any,
        method: query.method as any,
        forOfficeId: query.forOfficeId,
        createdById: query.createdById,
        since: query.since,
        until: query.until,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
        page: query.page ? parseInt(query.page, 10) : undefined,
      }, getViewer(request));
    },
  );

  // ------------------------------------------------------------------
  // GET election by ID
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };
      const election = await service.getElection(id, getViewer(request));
      if (!election) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      return election;
    },
  );

  // ------------------------------------------------------------------
  // CREATE election
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const body = request.body as any;

      // Permission check — Chancellor-only types require legislative_leader
      const chancellorTypes = [
        'legislative_vote',
        'position_election',
        'appointment_confirmation',
      ];
      if (chancellorTypes.includes(body.type)) {
        const isStaff = request.player?.isStaff ?? false;
        const hasPermission = isStaff
          ? true
          : (await aggregatePermissionsForPlayer(fastify.db, user.id)).includes('legislative_leader');
        if (!hasPermission) {
          return reply.status(403).send({
            error: 'Only the Chancellor or staff can create this election type',
          });
        }
      }

      const election = await service.createElection({
        ...body,
        createdById: user.id,
      });

      return reply.status(201).send(election);
    },
  );

  // ------------------------------------------------------------------
  // UPDATE election
  // ------------------------------------------------------------------
  fastify.patch(
    '/api/elections/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const { id } = request.params as { id: string };
      const body = request.body as any;

      // Only creator or staff can update
      const election = await service.getElection(id, getViewer(request));
      if (!election) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      if (election.createdById !== user.id && !request.player?.isStaff) {
        return reply.status(403).send({ error: 'Only the creator or staff can update this election' });
      }

      const updated = await service.updateElection(id, body);
      return updated;
    },
  );

  // ------------------------------------------------------------------
  // OPEN voting
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/open',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };
      const updated = await service.openVoting(id);
      if (!updated) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      return updated;
    },
  );

  // ------------------------------------------------------------------
  // CLOSE voting
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/close',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };
      const updated = await service.closeVoting(id);
      if (!updated) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      return updated;
    },
  );

  // ------------------------------------------------------------------
  // TALLY votes
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/tally',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };

      try {
        const results = await service.tallyVotes(id);
        return results;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET results
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections/:id/results',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };
      const result = await service.getElectionResults(id, getViewer(request));
      if (!result) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      return result;
    },
  );

  // ------------------------------------------------------------------
  // REGISTER candidate
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/candidates',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const election = await service.getElection(id, getViewer(request));
      if (!election) {
        return reply.status(404).send({ error: 'Election not found' });
      }

      // Self-registration only, unless staff is nominating someone else.
      const targetPlayerId = body.playerId ?? user.id;
      if (targetPlayerId !== user.id && !request.player?.isStaff) {
        return reply.status(403).send({
          error: 'Only staff can nominate other players',
        });
      }

      try {
        const candidate = await service.registerCandidate({
          electionId: id,
          playerId: targetPlayerId,
          partyId: body.partyId,
          statement: body.statement,
          // Always derive from session — never trust the client.
          nominatedById: user.id,
        });
        return reply.status(201).send(candidate);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // WITHDRAW / remove candidate (creator or staff)
  // ------------------------------------------------------------------
  fastify.delete(
    '/api/elections/:id/candidates/:playerId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const { id, playerId } = request.params as { id: string; playerId: string };

      const election = await service.getElection(id, getViewer(request));
      if (!election) {
        return reply.status(404).send({ error: 'Election not found' });
      }

      // The candidate themselves, the election creator, or staff can withdraw
      const isSelf = user.id === playerId;
      const isOwner = election.createdById === user.id;
      if (!isSelf && !isOwner && !request.player?.isStaff) {
        return reply.status(403).send({ error: 'Not allowed to withdraw this candidate' });
      }

      const updated = await service.withdrawCandidate(id, playerId);
      if (!updated) {
        return reply.status(404).send({ error: 'Candidate not found' });
      }
      return updated;
    },
  );

  // ------------------------------------------------------------------
  // CAST ballot
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/vote',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const election = await service.getElection(id, getViewer(request));
      if (!election) {
        return reply.status(404).send({ error: 'Election not found' });
      }

      try {
        const ballot = await service.castBallot({
          electionId: id,
          voterId: user.id,
          vote: body.vote ?? body,
        });
        return reply.status(201).send(ballot);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // CHECK eligibility
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections/:id/eligibility',
    { preHandler: [requireAuth] },
    async (request) => {
      const service = getService();
      const user = request.session.user!;
      const { id } = request.params as { id: string };
      return service.getEligibility(id, user.id, getViewer(request));
    },
  );

  // ------------------------------------------------------------------
  // GET turnout
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections/:id/turnout',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };
      const result = await service.getTurnout(id, getViewer(request));
      if (!result) {
        return reply.status(404).send({ error: 'Election not found' });
      }
      return result;
    },
  );

  // ------------------------------------------------------------------
  // NPC confirmation (staff only)
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/npc-confirm',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const user = request.session.user!;
      const { id } = request.params as { id: string };
      const body = request.body as any;

      try {
        const updated = await service.enterNpcConfirmation(id, {
          yea: body.yea,
          nay: body.nay,
          abstain: body.abstain,
          enteredById: user.id,
          notes: body.notes,
        });

        if (!updated) {
          return reply.status(404).send({ error: 'Election not found' });
        }
        return updated;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // CERTIFY (staff only)
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/certify',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };

      try {
        const updated = await service.certifyElection(id);
        return updated;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // CREATE runoff
  // ------------------------------------------------------------------
  fastify.post(
    '/api/elections/:id/create-runoff',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const service = getService();
      const { id } = request.params as { id: string };

      try {
        const runoff = await service.createRunoff(id);
        return reply.status(201).send(runoff);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET all rounds
  // ------------------------------------------------------------------
  fastify.get(
    '/api/elections/:id/rounds',
    { preHandler: [requireAuth] },
    async (request) => {
      const service = getService();
      const { id } = request.params as { id: string };
      return service.getRounds(id, getViewer(request));
    },
  );
}
