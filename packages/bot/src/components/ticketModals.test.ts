import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  isStaff: vi.fn(),
}));

vi.mock('../db.js', () => ({ db: mocks.db }));
vi.mock('../utils/permissions.js', () => ({ isStaff: mocks.isStaff }));

import { handleTicketModal } from './ticketModals.js';

function fakeThread(id: string) {
  return {
    id,
    type: ChannelType.PrivateThread,
    isThread: () => true,
    send: vi.fn().mockResolvedValue(undefined),
    setArchived: vi.fn().mockResolvedValue(undefined),
  };
}

const ticket = {
  id: 'ticket-uuid',
  number: 42,
  status: 'open',
  createdById: 'player-1',
  discordThreadId: 'ticket-thread',
  firstResponseAt: null,
  resolvedAt: null,
};

/** An insert chain that is awaitable directly and also exposes `.returning()`. */
function insertChain(returned: unknown[]) {
  const thenable = Object.assign(Promise.resolve(undefined), {
    returning: vi.fn().mockResolvedValue(returned),
  });
  return { values: vi.fn(() => thenable) };
}

describe('ticket_note_modal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(true);
    mocks.db.insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'staff-1', discordId: 'discord-staff' }]),
        })),
      })),
    });
    mocks.db.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([ticket]),
        })),
      })),
    });
    mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      insert: vi.fn(() => insertChain([{ id: 'msg-1' }])),
    }));
  });

  it("posts the note notice into the ticket's own thread, never the submitting channel", async () => {
    const ticketThread = fakeThread('ticket-thread');
    const unrelatedThread = fakeThread('unrelated-thread');
    const interaction = {
      customId: 'ticket_note_modal:42',
      fields: { getTextInputValue: vi.fn().mockReturnValue('Check the CDN link before replying.') },
      user: { id: 'discord-staff', username: 'staff' },
      member: { roles: [] },
      channel: unrelatedThread,
      client: {
        channels: { fetch: vi.fn(async (id: string) => (id === 'ticket-thread' ? ticketThread : null)) },
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleTicketModal(interaction as any);

    expect(unrelatedThread.send).not.toHaveBeenCalled();
    expect(ticketThread.send).toHaveBeenCalledTimes(1);
  });
});
