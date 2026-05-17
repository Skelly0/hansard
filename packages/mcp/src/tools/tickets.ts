import { z } from 'zod';
import { TicketService } from '@hansard/api/services/ticketService';
import { TicketPriority, TicketStatus } from '@hansard/shared';
import { jsonResult, safeHandler, type RegisterToolsFn } from './types.js';

const TICKET_STATUS_VALUES = Object.values(TicketStatus) as [string, ...string[]];
const TICKET_PRIORITY_VALUES = Object.values(TicketPriority) as [string, ...string[]];

interface GetTicketArgs {
  ticketId?: string;
  number?: number;
}

export const registerTicketTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_tickets',
    {
      description: 'List recent tickets visible to the authenticated session, with optional filters. Newest first.',
      inputSchema: {
        status: z.enum(TICKET_STATUS_VALUES).optional().describe(
          'One of: ' + TICKET_STATUS_VALUES.join(', '),
        ),
        priority: z.enum(TICKET_PRIORITY_VALUES).optional().describe(
          'One of: ' + TICKET_PRIORITY_VALUES.join(', '),
        ),
        categoryId: z.string().uuid().optional(),
        assignedToId: z.string().uuid().optional(),
        createdById: z.string().uuid().optional(),
        search: z.string().min(1).optional().describe('Case-insensitive title search.'),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args) => {
      const session = await ctx.session.get();
      const svc = new TicketService(ctx.db);
      const { tickets, total } = await svc.listTickets(
        args as Parameters<TicketService['listTickets']>[0],
        { userId: session.playerId, isStaff: session.isStaff },
      );
      return jsonResult({ count: tickets.length, total, tickets });
    }),
  );

  server.registerTool(
    'get_ticket',
    {
      description:
        'Get one visible ticket, including replies/messages and staff-visible audit history. Provide either ticketId or number.',
      inputSchema: {
        ticketId: z.string().uuid().optional().describe('Ticket UUID.'),
        number: z.number().int().positive().optional().describe('Human-readable ticket number, e.g. 42 for #42.'),
      },
    },
    safeHandler(async (args: GetTicketArgs) => {
      if ((args.ticketId && args.number !== undefined) || (!args.ticketId && args.number === undefined)) {
        throw new Error('Provide exactly one of ticketId or number.');
      }

      const session = await ctx.session.get();
      const svc = new TicketService(ctx.db);
      const viewer = { userId: session.playerId, isStaff: session.isStaff };
      const ticket = args.ticketId
        ? await svc.getTicket(args.ticketId, viewer)
        : await svc.getTicketByNumber(args.number!, viewer);

      return jsonResult({ ticket });
    }),
  );
};
