import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ticketRoutes from './tickets';

const auth = vi.hoisted(() => ({
  userId: 'creator-player',
  isStaff: false,
}));

const serviceMocks = vi.hoisted(() => ({
  getTicket: vi.fn(),
  addMessage: vi.fn(),
  updateTicket: vi.fn(),
  assignTicket: vi.fn(),
}));

const notifierMocks = vi.hoisted(() => ({
  notifyTicketOwnerOfReply: vi.fn(),
}));

const errorStubs = vi.hoisted(() => {
  class TicketAssigneeNotStaffErrorStub extends Error {
    constructor(message = 'Assignee must be staff') {
      super(message);
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
    addMessage = serviceMocks.addMessage;
    updateTicket = serviceMocks.updateTicket;
    assignTicket = serviceMocks.assignTicket;
  },
  TicketAssigneeNotStaffError: errorStubs.TicketAssigneeNotStaffErrorStub,
}));

vi.mock('../services/ticketOwnerNotifier.js', () => ({
  notifyTicketOwnerOfReply: notifierMocks.notifyTicketOwnerOfReply,
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
    serviceMocks.addMessage.mockResolvedValue({
      id: 'message-1',
      ticketId: 'ticket-1',
      authorId: auth.userId,
      content: 'A public reply',
      isInternal: false,
    });
    notifierMocks.notifyTicketOwnerOfReply.mockResolvedValue(undefined);
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

  it('rejects PATCH with assignedToId targeting a non-staff player as 400 from staff caller', async () => {
    auth.userId = 'staff-player';
    auth.isStaff = true;
    serviceMocks.getTicket.mockResolvedValue({
      id: 'ticket-1',
      createdById: 'creator-player',
      assignedToId: null,
    });
    serviceMocks.updateTicket.mockRejectedValue(
      new errorStubs.TicketAssigneeNotStaffErrorStub('Cannot assign ticket to a non-staff player'),
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

  it('notifies the ticket creator by DM when a web/API public reply is posted by someone else', async () => {
    auth.userId = 'staff-player';
    auth.isStaff = true;
    serviceMocks.getTicket.mockResolvedValue({
      id: 'ticket-1',
      number: 42,
      title: 'Favourite transfer',
      createdById: 'creator-player',
      assignedToId: null,
    });

    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets/ticket-1/messages',
      payload: {
        content: 'Yes, that transfer can go ahead.',
        isInternal: false,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(notifierMocks.notifyTicketOwnerOfReply).toHaveBeenCalledWith({
      db: app.db,
      ticket: expect.objectContaining({
        id: 'ticket-1',
        number: 42,
        title: 'Favourite transfer',
        createdById: 'creator-player',
      }),
      authorId: 'staff-player',
      content: 'Yes, that transfer can go ahead.',
    });
  });
});
