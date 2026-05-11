import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifierMocks = vi.hoisted(() => ({
  postToTicketThread: vi.fn(),
}));

vi.mock('./ticketThreadNotifier.js', () => ({
  postToTicketThread: notifierMocks.postToTicketThread,
}));

import { TicketService } from './ticketService.js';

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
