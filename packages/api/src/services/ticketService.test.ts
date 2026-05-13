import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifierMocks = vi.hoisted(() => ({
  postToTicketThread: vi.fn(),
}));

vi.mock('./ticketThreadNotifier.js', () => ({
  postToTicketThread: notifierMocks.postToTicketThread,
}));

import { TicketService, TicketAssigneeNotStaffError } from './ticketService.js';

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-a',
    number: 1,
    title: 'First ticket',
    linkedTicketIds: [],
    discordThreadId: 'thread-a',
    ...overrides,
  };
}

function makeDb(selectRows: unknown[][]) {
  const queue = [...selectRows];
  const limit = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { select, update, insert },
    update,
    insert,
  };
}

describe('TicketService link mirroring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not audit or mirror a link that already exists on both tickets', async () => {
    const ticketA = makeTicket({
      id: 'ticket-a',
      number: 10,
      title: 'First ticket',
      linkedTicketIds: ['ticket-b'],
      discordThreadId: 'thread-a',
    });
    const ticketB = makeTicket({
      id: 'ticket-b',
      number: 11,
      title: 'Second ticket',
      linkedTicketIds: ['ticket-a'],
      discordThreadId: 'thread-b',
    });
    const { db, update, insert } = makeDb([[ticketA], [ticketB], [ticketA]]);

    const result = await new TicketService(db as any).linkTickets(
      'ticket-a',
      'ticket-b',
      'actor-1',
    );

    expect(result).toMatchObject({ id: 'ticket-a' });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(notifierMocks.postToTicketThread).not.toHaveBeenCalled();
  });

  it('does not audit or mirror an unlink when neither ticket is linked', async () => {
    const ticketA = makeTicket({
      id: 'ticket-a',
      number: 10,
      title: 'First ticket',
      linkedTicketIds: [],
      discordThreadId: 'thread-a',
    });
    const ticketB = makeTicket({
      id: 'ticket-b',
      number: 11,
      title: 'Second ticket',
      linkedTicketIds: [],
      discordThreadId: 'thread-b',
    });
    const { db, update, insert } = makeDb([[ticketA], [ticketB], [ticketA]]);

    const result = await new TicketService(db as any).unlinkTickets(
      'ticket-a',
      'ticket-b',
      'actor-1',
    );

    expect(result).toMatchObject({ id: 'ticket-a' });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(notifierMocks.postToTicketThread).not.toHaveBeenCalled();
  });
});

describe('TicketService.updateTicket staff-assignee guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Build a db harness where each select() call returns one queued row set.
  function queueDb(queue: unknown[][]) {
    const pending = [...queue];
    const limit = vi.fn().mockImplementation(() => Promise.resolve(pending.shift() ?? []));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const updateWhereReturning = vi.fn().mockImplementation(() => Promise.resolve([{
      id: 'ticket-a',
      assignedToId: 'non-staff-player',
    }]));
    const updateWhere = vi.fn().mockImplementation((..._args: unknown[]) => ({
      returning: updateWhereReturning,
      then: (resolve: any) => resolve(undefined),
    }));
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values: insertValues });

    return { db: { select, update, insert }, update, insert };
  }

  it('rejects updateTicket when assignedToId targets a non-staff player', async () => {
    // Two select calls happen before validation: 1) ticket row, 2) player row.
    // Order in our implementation: load current ticket first, then look up the
    // player when assignedToId is set; both before any DB write.
    const currentTicket = {
      id: 'ticket-a',
      assignedToId: null,
      status: 'open',
      priority: 'normal',
      tags: [],
      title: 't',
      description: 'd',
      discordThreadId: null,
    };
    const nonStaffPlayer = { id: 'non-staff-player', isStaff: false };

    const { db, update, insert } = queueDb([
      [currentTicket], // initial ticket fetch in updateTicket
      [nonStaffPlayer], // assignee lookup
    ]);

    const service = new TicketService(db as any);

    await expect(
      service.updateTicket(
        'ticket-a',
        { assignedToId: 'non-staff-player' },
        'staff-actor',
      ),
    ).rejects.toBeInstanceOf(TicketAssigneeNotStaffError);

    // No ticket UPDATE should have happened.
    expect(update).not.toHaveBeenCalled();
    // No audit row inserted.
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects updateTicket when assignedToId references a player that does not exist', async () => {
    const currentTicket = {
      id: 'ticket-a',
      assignedToId: null,
      status: 'open',
      priority: 'normal',
      tags: [],
      title: 't',
      description: 'd',
      discordThreadId: null,
    };

    const { db, update, insert } = queueDb([
      [currentTicket],
      [], // assignee lookup returns no rows
    ]);

    const service = new TicketService(db as any);

    await expect(
      service.updateTicket(
        'ticket-a',
        { assignedToId: 'ghost-player' },
        'staff-actor',
      ),
    ).rejects.toBeInstanceOf(TicketAssigneeNotStaffError);

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('allows clearing assignedToId (null) without a staff lookup', async () => {
    const currentTicket = {
      id: 'ticket-a',
      assignedToId: 'prev-assignee',
      status: 'in_progress',
      priority: 'normal',
      tags: [],
      title: 't',
      description: 'd',
      discordThreadId: null,
    };

    const { db } = queueDb([[currentTicket]]);
    const service = new TicketService(db as any);

    await expect(
      service.updateTicket(
        'ticket-a',
        { assignedToId: null },
        'staff-actor',
      ),
    ).resolves.toBeTruthy();
  });
});
