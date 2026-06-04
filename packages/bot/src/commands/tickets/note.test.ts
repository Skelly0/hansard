import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './note.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  isStaff: vi.fn(),
  postToTicketThread: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('@hansard/api/services/ticketThreadNotifier', () => ({
  postToTicketThread: mocks.postToTicketThread,
}));

const authorPlayer = {
  id: 'staff-player-id',
  discordId: 'staff-discord-id',
  discordUsername: 'Staffer',
  characterName: 'Staff Character',
};

const ticket = {
  id: 'ticket-id',
  number: 42,
  createdById: 'owner-player-id',
  firstResponseAt: null,
  discordThreadId: 'thread-id',
};

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    member: { roles: { cache: new Map() } },
    options: {
      getInteger: vi.fn().mockReturnValue(42),
      getString: vi.fn().mockReturnValue('Private staff note.'),
    },
    user: {
      id: authorPlayer.discordId,
      username: authorPlayer.discordUsername,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticket note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff.mockResolvedValue(true);
    mocks.db.select
      .mockImplementationOnce(() => selectLimit([authorPlayer]))
      .mockImplementationOnce(() => selectLimit([ticket]));
    mocks.db.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    });
    mocks.db.insert
      .mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'message-id' }]),
        })),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      });
    mocks.postToTicketThread.mockResolvedValue(undefined);
  });

  it('does not mark an internal note as the first ticket response', async () => {
    await execute(makeInteraction() as any);

    const set = mocks.db.update.mock.results[0].value.set;
    expect(set).toHaveBeenCalledWith(
      expect.not.objectContaining({ firstResponseAt: expect.any(Date) }),
    );
  });
});
