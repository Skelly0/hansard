import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifierMocks = vi.hoisted(() => ({
  postToTicketThread: vi.fn(),
}));

vi.mock('./ticketThreadNotifier.js', () => ({
  postToTicketThread: notifierMocks.postToTicketThread,
}));

import { TicketService, TicketAssigneeNotStaffError } from './ticketService.js';

function makeGetTicketDb(selectRows: unknown[][]) {
  const queue = [...selectRows];
  const take = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));

  const query: Record<string, unknown> = {};
  query.where = vi.fn().mockReturnValue(query);
  query.limit = vi.fn().mockImplementation(take);
  query.orderBy = vi.fn().mockImplementation(take);
  query.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    take().then(resolve, reject);

  const from = vi.fn().mockReturnValue(query);
  const select = vi.fn().mockReturnValue({ from });

  return { db: { select } };
}

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

describe('TicketService.getTicket detail enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes player summaries needed by the ticket webapp detail view', async () => {
    const ticket = makeTicket({
      categoryId: 'category-a',
      createdById: 'creator-player',
      assignedToId: 'staff-player',
    });
    const message = {
      id: 'message-a',
      ticketId: 'ticket-a',
      authorId: 'creator-player',
      content: 'Please transfer my favours.',
      isInternal: false,
      discordMessageId: null,
      createdAt: new Date('2026-05-22T15:28:00Z'),
      editedAt: null,
    };
    const auditEntry = {
      id: 'audit-a',
      ticketId: 'ticket-a',
      actorId: 'staff-player',
      action: 'assigned',
      oldValue: null,
      newValue: 'staff-player',
      createdAt: new Date('2026-05-22T15:29:00Z'),
    };
    const category = { id: 'category-a', name: 'Favours' };
    const creator = {
      id: 'creator-player',
      characterName: 'Ada Vance',
      discordUsername: 'ada',
    };
    const staff = {
      id: 'staff-player',
      characterName: null,
      discordUsername: 'staffer',
    };
    const { db } = makeGetTicketDb([
      [ticket],
      [message],
      [auditEntry],
      [category],
      [creator, staff],
    ]);

    const result = await new TicketService(db as any).getTicket('ticket-a', {
      userId: 'staff-player',
      isStaff: true,
    });

    expect(result).toMatchObject({
      createdBy: creator,
      assignedTo: staff,
      messages: [
        expect.objectContaining({
          author: creator,
        }),
      ],
      auditLog: [
        expect.objectContaining({
          actor: staff,
        }),
      ],
    });
  });
});

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

describe('TicketService.addMessage Discord idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeAddMessageDb(selectRows: unknown[][]) {
    const queue = [...selectRows];
    const limit = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });

    const returning = vi.fn().mockResolvedValue([{
      id: 'new-message',
      ticketId: 'ticket-a',
      authorId: 'staff-player',
      content: 'already handled',
      isInternal: false,
      discordMessageId: 'discord-message-1',
    }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    return {
      db: { select, update, insert },
      update,
      insert,
    };
  }

  it('does not insert or mirror a Discord-origin message that was already recorded', async () => {
    const ticket = makeTicket({
      createdById: 'owner-player',
      assignedToId: null,
      firstResponseAt: null,
    });
    const existingMessage = {
      id: 'existing-message',
      ticketId: 'ticket-a',
      authorId: 'staff-player',
      content: 'already handled',
      isInternal: false,
      discordMessageId: 'discord-message-1',
    };
    const { db, update, insert } = makeAddMessageDb([[ticket], [existingMessage]]);

    const result = await new TicketService(db as any).addMessage(
      'ticket-a',
      'already handled',
      'staff-player',
      false,
      'discord-message-1',
      true,
      false,
    );

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(notifierMocks.postToTicketThread).not.toHaveBeenCalled();
  });
});

describe('TicketService.assignTicket staff guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeAssignDb(targetRows: unknown[][]) {
    // Each call to .select().from(...).where(...).limit() pops the next row
    // batch. We always start with the assignee lookup; updateTicket reads
    // happen via .update on db.update so they don't affect this queue.
    const queue = [...targetRows];
    const limit = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const returningUpdate = vi.fn().mockResolvedValue([{ id: 'ticket-1', discordThreadId: null }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: returningUpdate });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values: insertValues });

    return {
      db: { select, update, insert },
      update,
      insert,
    };
  }

  it('rejects assignment to a player who is not staff', async () => {
    const nonStaff = { id: 'player-non-staff', isStaff: false };
    const { db, update, insert } = makeAssignDb([[nonStaff]]);

    await expect(
      new TicketService(db as any).assignTicket('ticket-1', 'player-non-staff', 'actor-staff'),
    ).rejects.toBeInstanceOf(TicketAssigneeNotStaffError);

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects assignment when the target player does not exist', async () => {
    const { db, update, insert } = makeAssignDb([[]]);

    await expect(
      new TicketService(db as any).assignTicket('ticket-1', 'ghost-player', 'actor-staff'),
    ).rejects.toBeInstanceOf(TicketAssigneeNotStaffError);

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
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
