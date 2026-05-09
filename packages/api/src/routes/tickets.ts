import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { TicketService } from '../services/ticketService.js';
import '../plugins/db.js'; // augments FastifyInstance with .db
import type { TicketStatus, TicketPriority } from '@hansard/shared';
import type { TicketAccessContext } from '../services/ticketService.js';

/**
 * Ticket routes plugin.
 *
 * Expects `fastify.db` to be decorated by the db plugin (registered in app.ts).
 */
export default async function ticketRoutes(fastify: FastifyInstance) {
  const ticketService = new TicketService(fastify.db);
  const getViewer = (request: FastifyRequest): TicketAccessContext => ({
    userId: request.session.user!.id,
    isStaff: request.player?.isStaff ?? false,
  });
  const getSessionActor = (request: FastifyRequest): { id: string; isStaff: boolean } => ({
    id: request.session.user!.id,
    isStaff: request.player?.isStaff ?? false,
  });

  const getViewerFromActor = (user: { id: string; isStaff: boolean }): TicketAccessContext => ({
    userId: user.id,
    isStaff: user.isStaff,
  });

  // ============================================================
  // GET /api/tickets — List tickets with filters
  // ============================================================

  fastify.get<{
    Querystring: {
      status?: TicketStatus;
      categoryId?: string;
      category?: string;
      assignedToId?: string;
      assignee?: string;
      createdById?: string;
      priority?: TicketPriority;
      search?: string;
      limit?: string;
      offset?: string;
      page?: string;
    };
  }>(
    '/api/tickets',
    { preHandler: [requireAuth] },
    async (request) => {
      const {
        status,
        categoryId,
        category,
        assignedToId,
        assignee,
        createdById,
        priority,
        search,
        limit,
        offset,
        page,
      } = request.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const parsedOffset = offset
        ? parseInt(offset, 10)
        : page && parsedLimit
          ? (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit
          : undefined;

      const result = await ticketService.listTickets({
        status: status as TicketStatus | undefined,
        categoryId: categoryId ?? category,
        assignedToId: assignedToId ?? assignee,
        createdById,
        priority: priority as TicketPriority | undefined,
        search,
        limit: parsedLimit,
        offset: parsedOffset,
      }, getViewer(request));
      return { data: result.tickets, total: result.total };
    },
  );

  // ============================================================
  // GET /api/tickets/categories — List ticket categories
  // ============================================================

  fastify.get(
    '/api/tickets/categories',
    { preHandler: [requireAuth] },
    async () => {
      return ticketService.getCategories();
    },
  );

  // ============================================================
  // GET /api/tickets/metrics — Dashboard metrics
  // ============================================================

  fastify.get(
    '/api/tickets/metrics',
    { preHandler: [requireAuth] },
    async (request) => {
      return ticketService.getMetrics(getViewer(request));
    },
  );

  // ============================================================
  // GET /api/tickets/by-ids?ids=a,b,c — Batch lookup by ID
  // ============================================================

  fastify.get<{ Querystring: { ids?: string } }>(
    '/api/tickets/by-ids',
    { preHandler: [requireAuth] },
    async (request) => {
      const raw = request.query.ids ?? '';
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
      const results = await ticketService.getTicketsByIds(ids, getViewer(request));
      return { tickets: results };
    },
  );

  // ============================================================
  // GET /api/tickets/:id — Get ticket with messages + audit log
  // ============================================================

  fastify.get<{ Params: { id: string } }>(
    '/api/tickets/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ticket = await ticketService.getTicket(
        request.params.id,
        getViewer(request),
      );
      if (!ticket) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }
      return ticket;
    },
  );

  // ============================================================
  // POST /api/tickets — Create ticket
  // ============================================================

  fastify.post<{
    Body: {
      categoryId: string;
      title: string;
      description: string;
      formData?: Record<string, unknown>;
      priority?: TicketPriority;
      tags?: string[];
    };
  }>(
    '/api/tickets',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.session.user!;
      const { categoryId, title, description, formData, priority, tags } = request.body;

      if (!categoryId || !title || !description) {
        return reply.status(400).send({ error: 'categoryId, title, and description are required' });
      }

      const ticket = await ticketService.createTicket({
        categoryId,
        createdById: user.id,
        title,
        description,
        formData,
        priority,
        tags,
      });

      return reply.status(201).send(ticket);
    },
  );

  // ============================================================
  // PATCH /api/tickets/:id — Update ticket
  // ============================================================

  fastify.patch<{
    Params: { id: string };
    Body: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignedToId?: string | null;
      tags?: string[];
      title?: string;
      description?: string;
    };
  }>(
    '/api/tickets/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getSessionActor(request);
      const body = request.body;

      const ticket = await ticketService.getTicket(request.params.id, getViewerFromActor(user));
      if (!ticket) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      const isStaff = user.isStaff;
      const isCreator = ticket.createdById === user.id;

      // status / priority / assignedToId are staff-only
      const wantsStaffOnly =
        body.status !== undefined ||
        body.priority !== undefined ||
        body.assignedToId !== undefined ||
        body.tags !== undefined;
      if (wantsStaffOnly && !isStaff) {
        return reply.status(403).send({
          error: 'Only staff can change status, priority, assignee, or tags',
        });
      }

      // title / description editable by creator or staff
      const wantsContentEdit =
        body.title !== undefined || body.description !== undefined;
      if (wantsContentEdit && !isCreator && !isStaff) {
        return reply.status(403).send({
          error: 'Only the ticket creator or staff can edit title/description',
        });
      }

      const updated = await ticketService.updateTicket(
        request.params.id,
        body,
        user.id,
      );

      if (!updated) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      return updated;
    },
  );

  // ============================================================
  // POST /api/tickets/:id/messages — Add message
  // ============================================================

  fastify.post<{
    Params: { id: string };
    Body: {
      content: string;
      isInternal?: boolean;
    };
  }>(
    '/api/tickets/:id/messages',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getSessionActor(request);
      const { content, isInternal } = request.body;

      if (!content) {
        return reply.status(400).send({ error: 'content is required' });
      }

      const ticket = await ticketService.getTicket(request.params.id, getViewerFromActor(user));
      if (!ticket) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      // Only staff can post internal notes
      if (isInternal && !user.isStaff) {
        return reply.status(403).send({ error: 'Only staff can post internal notes' });
      }

      const message = await ticketService.addMessage(
        request.params.id,
        content,
        user.id,
        isInternal ?? false,
        undefined,
        user.isStaff,
      );

      if (!message) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      return reply.status(201).send(message);
    },
  );

  // ============================================================
  // POST /api/tickets/:id/assign — Assign to staff member
  // ============================================================

  fastify.post<{
    Params: { id: string };
    Body: { assigneeId?: string; assignedToId?: string };
  }>(
    '/api/tickets/:id/assign',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = getSessionActor(request);
      const target = request.body.assigneeId ?? request.body.assignedToId;

      if (!target) {
        return reply.status(400).send({ error: 'assigneeId is required' });
      }

      const updated = await ticketService.assignTicket(
        request.params.id,
        target,
        user.id,
      );

      if (!updated) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      return updated;
    },
  );

  // ============================================================
  // POST /api/tickets/:id/close — Close ticket
  // ============================================================

  fastify.post<{
    Params: { id: string };
    Body: { resolution?: string };
  }>(
    '/api/tickets/:id/close',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getSessionActor(request);
      const { resolution } = request.body ?? {};

      const ticket = await ticketService.getTicket(request.params.id, getViewerFromActor(user));
      if (!ticket) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      const allowed =
        ticket.createdById === user.id ||
        ticket.assignedToId === user.id ||
        user.isStaff;
      if (!allowed) {
        return reply.status(403).send({
          error: 'Only the creator, assignee, or staff can close this ticket',
        });
      }

      const updated = await ticketService.closeTicket(
        request.params.id,
        resolution ?? null,
        user.id,
        user.isStaff,
      );

      if (!updated) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      return updated;
    },
  );

  // ============================================================
  // POST /api/tickets/:id/link — Link two tickets symmetrically (staff)
  // ============================================================

  fastify.post<{
    Params: { id: string };
    Body: { otherTicketId: string };
  }>(
    '/api/tickets/:id/link',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { otherTicketId } = request.body;
      if (!otherTicketId) {
        return reply.status(400).send({ error: 'otherTicketId is required' });
      }
      if (otherTicketId === request.params.id) {
        return reply.status(400).send({ error: 'Cannot link a ticket to itself' });
      }

      const updated = await ticketService.linkTickets(
        request.params.id,
        otherTicketId,
        request.session.user!.id,
      );

      if (!updated) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }
      return updated;
    },
  );

  // ============================================================
  // DELETE /api/tickets/:id/link/:otherId — Unlink two tickets (staff)
  // ============================================================

  fastify.delete<{
    Params: { id: string; otherId: string };
  }>(
    '/api/tickets/:id/link/:otherId',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const updated = await ticketService.unlinkTickets(
        request.params.id,
        request.params.otherId,
        request.session.user!.id,
      );
      if (!updated) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }
      return updated;
    },
  );

  // ============================================================
  // POST /api/tickets/categories — Create/update category (admin)
  // ============================================================

  fastify.post<{
    Body: {
      id?: string;
      name: string;
      description?: string;
      emoji?: string;
      colour?: string;
      assignableRoles?: string[];
      sortOrder?: number;
    };
  }>(
    '/api/tickets/categories',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { name } = request.body;

      if (!name) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const category = await ticketService.createOrUpdateCategory(request.body);
      return reply.status(201).send(category);
    },
  );
}
