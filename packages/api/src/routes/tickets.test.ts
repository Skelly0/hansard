import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ticketRoutes from './tickets';
import { TicketAssigneeNotStaffError } from '../services/ticketService.js';

const auth = vi.hoisted(() => ({
  userId: 'creator-player',
  isStaff: false,
}));

const serviceMocks = vi.hoisted(() => ({
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  assignTicket: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: auth.userId } };
    request.player = { id: auth.userId, isStaff: auth.isStaff };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../services/ticketService.js', () => {
  class TicketAssigneeNotStaffError extends Error {
    constructor(message = 'Cannot assign ticket to a non-staff player') {
      super(message);
      this.name = 'TicketAssigneeNotStaffError';
    }
  }
  return {
    TicketAssigneeNotStaffError,
    TicketService: class {
      getTicket = serviceMocks.getTicket;
      updateTicket = serviceMocks.updateTicket;
      assignTicket = serviceMocks.assignTicket;
    },
  };
});

async function appWithDb() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(ticketRoutes);
  return app;
}

describe('ticket routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.userId = 'creator-player';
    auth.isStaff = false;
    serviceMocks.getTicket.mockResolvedValue({
      id: 'ticket-1',
      createdById: 'creator-player',
      assignedToId: null,
    });
    serviceMocks.updateTicket.mockResolvedValue({
      id: 'ticket-1',
      discordThreadId: 'attacker-thread',
    });
  });

  it('does not let non-staff change the Discord thread mirror target', async () => {
    const app = await appWithDb();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tickets/ticket-1',
      payload: {
        discordThreadId: 'attacker-thread',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(serviceMocks.updateTicket).not.toHaveBeenCalled();
  });

  it('rejects PATCH with assignedToId targeting a non-staff player as 400 from staff caller', async () => {
    auth.userId = 'staff-player';
    auth.isStaff = true;
    serviceMocks.getTicket.mockResolvedValue({
      id: 'ticket-1',
      createdById: 'creator-player',
      assignedToId: null,
    });
    serviceMocks.updateTicket.mockRejectedValue(
      new TicketAssigneeNotStaffError('Cannot assign ticket to a non-staff player'),
    );

    const app = await appWithDb();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tickets/ticket-1',
      payload: {
        assignedToId: 'non-staff-uuid',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('non-staff');
  });
});
