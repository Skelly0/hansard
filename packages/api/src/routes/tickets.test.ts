import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ticketRoutes from './tickets';

const auth = vi.hoisted(() => ({
  userId: 'creator-player',
  isStaff: false,
}));

const serviceMocks = vi.hoisted(() => ({
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  assignTicket: vi.fn(),
}));

const errorStubs = vi.hoisted(() => {
  class TicketAssigneeNotStaffErrorStub extends Error {
    constructor() {
      super('Assignee must be staff');
      this.name = 'TicketAssigneeNotStaffError';
    }
  }
  return { TicketAssigneeNotStaffErrorStub };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: auth.userId } };
    request.player = { id: auth.userId, isStaff: auth.isStaff };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../services/ticketService.js', () => ({
  TicketService: class {
    getTicket = serviceMocks.getTicket;
    updateTicket = serviceMocks.updateTicket;
    assignTicket = serviceMocks.assignTicket;
  },
  TicketAssigneeNotStaffError: errorStubs.TicketAssigneeNotStaffErrorStub,
}));

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

  it('refuses to assign a ticket to a non-staff player and returns 400', async () => {
    auth.isStaff = true;
    serviceMocks.assignTicket.mockRejectedValue(new errorStubs.TicketAssigneeNotStaffErrorStub());

    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets/ticket-1/assign',
      payload: { assigneeId: 'non-staff-player' },
    });

    expect(res.statusCode).toBe(400);
    expect(serviceMocks.assignTicket).toHaveBeenCalledWith(
      'ticket-1',
      'non-staff-player',
      'creator-player',
    );
  });
});
