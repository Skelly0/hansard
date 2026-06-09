import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { requireRole } from '../middleware/requireRole.js';
import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, documents } from '@hansard/db';
import type { BillType, EstimatedEffects } from '@hansard/shared';
import {
  submitBill,
  submitBillFor,
  getBill,
  getBillByNumber,
  listBills,
  searchBills,
  updateBill,
  updateEffects,
  createVoteOnBill,
  enterNpcVote,
  enactBill,
  repealBill,
  getBillStatusLog,
  getVoters,
} from '../services/billService.js';
import { cacheDocContent, isValidGoogleDocUrl } from '../services/googleDocService.js';
import { aggregatePermissionsForPlayer } from '../services/playerService.js';

/**
 * Bill routes plugin.
 *
 * Expects `fastify.db` to be decorated by the DB plugin.
 */
export default async function billRoutes(fastify: FastifyInstance) {
  const db = (fastify as any).db as Database;
  const getViewer = (request: { session: { user?: { id: string } }; player?: { isStaff?: boolean } }) => ({
    userId: request.session.user!.id,
    isStaff: !!request.player?.isStaff,
  });

  // ============================================================
  // GET /api/bills/search — Full-text search (must be before :slug)
  // ============================================================

  fastify.get<{
    Querystring: {
      q?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/bills/search',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { q, limit, offset } = request.query;

      if (!q) {
        return reply.status(400).send({ error: 'Query parameter "q" is required' });
      }

      const result = await searchBills(
        db,
        q,
        limit ? parseInt(limit, 10) : undefined,
        offset ? parseInt(offset, 10) : undefined,
      );
      return { data: result.bills, total: result.total };
    },
  );

  // ============================================================
  // GET /api/bills/browse — Dashboard browse with filters/sorting
  // ============================================================

  fastify.get<{
    Querystring: {
      status?: string;
      authorId?: string;
      author?: string;
      policyArea?: string;
      tags?: string;
      search?: string;
      sort?: string;
      amendsBillId?: string;
      limit?: string;
      offset?: string;
      page?: string;
    };
  }>(
    '/api/bills/browse',
    { preHandler: [requireAuth] },
    async (request) => {
      const { status, authorId, author, policyArea, tags, search, sort, amendsBillId, limit, offset, page } = request.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const parsedOffset = offset
        ? parseInt(offset, 10)
        : page && parsedLimit
          ? (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit
          : undefined;

      const result = await listBills(db, {
        status,
        authorId: authorId ?? author,
        policyArea,
        tags: tags ? tags.split(',') : undefined,
        search,
        sort,
        amendsBillId,
        limit: parsedLimit,
        offset: parsedOffset,
      });
      return { data: result.bills, total: result.total };
    },
  );

  // ============================================================
  // GET /api/bills — List bills with filters
  // ============================================================

  fastify.get<{
    Querystring: {
      status?: string;
      authorId?: string;
      author?: string;
      policyArea?: string;
      tags?: string;
      search?: string;
      sort?: string;
      amendsBillId?: string;
      limit?: string;
      offset?: string;
      page?: string;
    };
  }>(
    '/api/bills',
    { preHandler: [requireAuth] },
    async (request) => {
      const { status, authorId, author, policyArea, tags, search, sort, amendsBillId, limit, offset, page } = request.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const parsedOffset = offset
        ? parseInt(offset, 10)
        : page && parsedLimit
          ? (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit
          : undefined;

      const result = await listBills(db, {
        status,
        authorId: authorId ?? author,
        policyArea,
        tags: tags ? tags.split(',') : undefined,
        search,
        sort,
        amendsBillId,
        limit: parsedLimit,
        offset: parsedOffset,
      });
      return { data: result.bills, total: result.total };
    },
  );

  // ============================================================
  // GET /api/bills/:slug — Get bill with full details
  // ============================================================

  fastify.get<{ Params: { slug: string } }>(
    '/api/bills/:slug',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const bill = await getBill(db, request.params.slug);
      if (!bill) {
        return reply.status(404).send({ error: 'Bill not found' });
      }
      return bill;
    },
  );

  // ============================================================
  // GET /api/bills/:slug/status-log — Full status history
  // ============================================================

  fastify.get<{ Params: { slug: string } }>(
    '/api/bills/:slug/status-log',
    { preHandler: [requireAuth] },
    async (request) => {
      return getBillStatusLog(db, request.params.slug);
    },
  );

  // ============================================================
  // GET /api/bills/:slug/voters — Who voted on this bill
  // ============================================================

  fastify.get<{ Params: { slug: string } }>(
    '/api/bills/:slug/voters',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const result = await getVoters(db, request.params.slug, getViewer(request));
      if (!result) {
        return reply.status(404).send({ error: 'Bill not found' });
      }
      return result;
    },
  );

  // ============================================================
  // POST /api/bills — Submit a new bill
  // ============================================================

  fastify.post<{
    Body: {
      title: string;
      billType?: string;
      googleDocUrl?: string | null;
      content?: string;
      summary?: string;
      tags?: string[];
      policyAreas?: string[];
      shortTitle?: string;
      collectionId?: string;
      coSponsorIds?: string[];
      authorId?: string; // for submit-on-behalf
      amendsBillId?: string;
      amendsDocumentId?: string;
    };
  }>(
    '/api/bills',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.session.user!;
      const { title, billType, googleDocUrl, content, authorId, ...rest } = request.body;
      const requestedBillType = billType ?? (content?.trim() ? 'short' : 'google_doc');

      if (!title) {
        return reply.status(400).send({ error: 'title is required' });
      }
      if (requestedBillType === 'short' && !content?.trim()) {
        return reply.status(400).send({ error: 'title and content are required for short bills' });
      }
      if (requestedBillType === 'google_doc' && !googleDocUrl?.trim()) {
        return reply.status(400).send({ error: 'title and googleDocUrl are required for Google Doc bills' });
      }
      if (requestedBillType === 'google_doc' && !isValidGoogleDocUrl(googleDocUrl!.trim())) {
        return reply.status(400).send({
          error: 'googleDocUrl must be a valid https://docs.google.com/document/d/... URL',
        });
      }
      if (requestedBillType !== 'short' && requestedBillType !== 'google_doc') {
        return reply.status(400).send({ error: 'billType must be google_doc or short' });
      }
      const validatedBillType = requestedBillType as BillType;

      // Validate amendment targets exist if provided
      if (rest.amendsBillId) {
        const [exists] = await db.select({ id: bills.id }).from(bills).where(eq(bills.id, rest.amendsBillId)).limit(1);
        if (!exists) {
          return reply.status(400).send({ error: 'amendsBillId references a bill that does not exist' });
        }
      }
      if (rest.amendsDocumentId) {
        const [exists] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, rest.amendsDocumentId)).limit(1);
        if (!exists) {
          return reply.status(400).send({ error: 'amendsDocumentId references a document that does not exist' });
        }
      }

      const billData = {
        title,
        billType: validatedBillType,
        googleDocUrl: googleDocUrl?.trim() ?? null,
        content: content?.trim(),
        ...rest,
      };

      let bill;
      if (authorId && authorId !== user.id) {
        // Submitting on behalf — requires legislative_leader or staff
        const isStaff = request.player?.isStaff ?? false;
        const livePermissions = isStaff
          ? []
          : await aggregatePermissionsForPlayer(db, user.id);
        if (!isStaff && !livePermissions.includes('legislative_leader')) {
          return reply.status(403).send({
            error: 'Only the Chancellor or staff can submit bills on behalf of other players',
          });
        }
        if (isStaff) request.staffActionLog = true;
        bill = await submitBillFor(db, authorId, user.id, billData);
      } else {
        bill = await submitBill(db, user.id, billData);
      }

      return reply.status(201).send(bill);
    },
  );

  // ============================================================
  // POST /api/bills/:slug/cache — Re-cache content from Google Doc
  // ============================================================

  fastify.post<{ Params: { slug: string } }>(
    '/api/bills/:slug/cache',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const bill = await getBill(db, request.params.slug);
      if (!bill) {
        return reply.status(404).send({ error: 'Bill not found' });
      }

      // Only the author or staff can re-cache
      const user = request.session.user!;
      const isStaff = request.player?.isStaff ?? false;
      if (bill.authorId !== user.id && !isStaff) {
        return reply.status(403).send({ error: 'Only the bill author or staff can re-cache content' });
      }
      if (bill.billType === 'short') {
        return reply.status(400).send({ error: 'Short bills do not have Google Docs to re-cache' });
      }

      if (isStaff && bill.authorId !== user.id) request.staffActionLog = true;
      const content = await cacheDocContent(db, bill.id);
      return { cached: !!content, content };
    },
  );

  // ============================================================
  // PATCH /api/bills/:slug — Update bill metadata
  // ============================================================

  fastify.patch<{
    Params: { slug: string };
    Body: {
      title?: string;
      shortTitle?: string;
      summary?: string;
      tags?: string[];
      policyAreas?: string[];
      crossReferences?: string[];
      collectionId?: string;
    };
  }>(
    '/api/bills/:slug',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const bill = await getBill(db, request.params.slug);
      if (!bill) {
        return reply.status(404).send({ error: 'Bill not found' });
      }

      const user = request.session.user!;
      const isStaff = request.player?.isStaff ?? false;
      if (bill.authorId !== user.id && !isStaff) {
        return reply.status(403).send({ error: 'Only the bill author or staff can update this bill' });
      }

      if (isStaff && bill.authorId !== user.id) request.staffActionLog = true;
      const updated = await updateBill(db, request.params.slug, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'Bill not found' });
      }
      return updated;
    },
  );

  // ============================================================
  // PATCH /api/bills/:slug/effects — Update economy/popsim effects (staff)
  // ============================================================

  fastify.patch<{
    Params: { slug: string };
    Body: EstimatedEffects;
  }>(
    '/api/bills/:slug/effects',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const updated = await updateEffects(db, request.params.slug, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'Bill not found' });
      }
      return updated;
    },
  );

  // ============================================================
  // POST /api/bills/:slug/create-vote — Create legislature vote (Chancellor)
  // ============================================================

  fastify.post<{ Params: { slug: string } }>(
    '/api/bills/:slug/create-vote',
    { preHandler: [requireAuth, requireRole('legislative_leader')] },
    async (request, reply) => {
      const user = request.session.user!;
      if (request.player?.isStaff) request.staffActionLog = true;
      try {
        const result = await createVoteOnBill(db, request.params.slug, user.id);
        return reply.status(201).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create vote';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // POST /api/bills/:slug/npc-vote — Enter NPC house vote (staff)
  // ============================================================

  fastify.post<{
    Params: { slug: string };
    Body: {
      yea: number;
      nay: number;
      abstain: number;
      notes?: string;
    };
  }>(
    '/api/bills/:slug/npc-vote',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = request.session.user!;
      const { yea, nay, abstain, notes } = request.body;

      if (yea === undefined || nay === undefined || abstain === undefined) {
        return reply.status(400).send({ error: 'yea, nay, and abstain are required' });
      }

      try {
        const bill = await enterNpcVote(
          db,
          request.params.slug,
          { yea, nay, abstain },
          notes ?? null,
          user.id,
        );
        return bill;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enter NPC vote';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // POST /api/bills/:slug/enact — Mark bill as enacted (staff)
  // ============================================================

  fastify.post<{ Params: { slug: string } }>(
    '/api/bills/:slug/enact',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = request.session.user!;
      try {
        const bill = await enactBill(db, request.params.slug, user.id);
        return bill;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enact bill';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // POST /api/bills/:slug/repeal — Mark bill as repealed
  // ============================================================

  fastify.post<{
    Params: { slug: string };
    Body: { repealingBillId: string };
  }>(
    '/api/bills/:slug/repeal',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = request.session.user!;
      const { repealingBillId } = request.body;

      if (!repealingBillId) {
        return reply.status(400).send({ error: 'repealingBillId is required' });
      }

      try {
        const bill = await repealBill(db, request.params.slug, repealingBillId, user.id);
        return bill;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to repeal bill';
        return reply.status(400).send({ error: message });
      }
    },
  );
}
