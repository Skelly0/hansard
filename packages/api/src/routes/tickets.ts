import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { TicketService } from '../services/ticketService.js';
import '../plugins/db.js'; // augments FastifyInstance with .db
import type { TicketStatus, TicketPriority } from '@hansard/shared';

/**
 * Ticket routes plugin.
 *
 * Expects `fastify.db` to be decorated by the db plugin (registered in app.ts).
 */
export default async function ticketRoutes(fastify: FastifyInstance) {
  const ticketService = new TicketService(fastify.db);

  // ============================================================
  // GET /api/tickets — List tickets with filters
  // ============================================================

  fastify.get<{
    Querystring: {
      status?: TicketStatus;
      categoryId?: string;
      assignedToId?: string;
      createdById?: string;
      priority?: TicketPriority;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/tickets',
    { preHandler: [requireAuth] },
    async (request) => {
      const {
        status,
        categoryId,
        assignedToId,
        createdById,
        priority,
        search,
        limit,
        offset,
      } = request.query;

      return ticketService.listTickets({
        status: status as TicketStatus | undefined,
        categoryId,
        assignedToId,
        createdById,
        priority: priority as TicketPriority | undefined,
        search,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
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
    async () => {
      return ticketService.getMetrics();
    },
  );

  // ============================================================
  // GET /api/tickets/:id — Get ticket with messages + audit log
  // ============================================================

  fastify.get<{ Params: { id: string } }>(
    '/api/tickets/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ticket = await ticketService.getTicket(request.params.id);
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
      const user = request.session.user!;
      const updated = await ticketService.updateTicket(
        request.params.id,
        request.body,
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
      const user = request.session.user!;
      const { content, isInternal } = request.body;

      if (!content) {
        return reply.status(400).send({ error: 'content is required' });
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
      );

      return reply.status(201).send(message);
    },
  );

  // ============================================================
  // POST /api/tickets/:id/assign — Assign to staff member
  // ============================================================

  fastify.post<{
    Params: { id: string };
    Body: { assigneeId: string };
  }>(
    '/api/tickets/:id/assign',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = request.session.user!;
      const { assigneeId } = request.body;

      if (!assigneeId) {
        return reply.status(400).send({ error: 'assigneeId is required' });
      }

      const updated = await ticketService.assignTicket(
        request.params.id,
        assigneeId,
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
      const user = request.session.user!;
      const { resolution } = request.body ?? {};

      const updated = await ticketService.closeTicket(
        request.params.id,
        resolution ?? null,
        user.id,
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
