import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './reopen.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  isStaff: vi.fn(),
  txUpdateValues: [] as Record<string, unknown>[],
  txInsertValues: [] as Record<string, unknown>[],
  threadSetArchived: vi.fn(),
  threadSetLocked: vi.fn(),
  threadSend: vi.fn(),
  guildChannelsFetch: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

const actorPlayer = {
  id: 'actor-player-id',
  discordId: 'staff-discord-id',
  discordUsername: 'Staffer',
};

const closedTicket = {
  id: 'ticket-id',
  number: 42,
  title: 'Missing thread messages',
  createdById: 'owner-player-id',
  status: 'closed',
  resolvedAt: new Date('2026-05-10T12:00:00.000Z'),
  closedAt: new Date('2026-05-10T12:00:00.000Z'),
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

function playerUpsert(rows: unknown[]) {
  return {
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function transactionHarness() {
  return async (
    callback: (tx: {
      update: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>,
  ) => {
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn((values) => {
          mocks.txUpdateValues.push(values);
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values) => {
          mocks.txInsertValues.push(values);
          if ('content' in values) {
            return {
              returning: vi.fn().mockResolvedValue([{ id: 'message-id' }]),
            };
          }
          return Promise.resolve([]);
        }),
      })),
    };

    return callback(tx);
  };
}

function makeInteraction() {
  return {
    options: {
      getInteger: vi.fn().mockReturnValue(42),
      getString: vi.fn().mockReturnValue('New evidence came in.'),
    },
    user: {
      id: actorPlayer.discordId,
      username: actorPlayer.discordUsername,
      toString: () => '<@staff-discord-id>',
    },
    member: { roles: { cache: new Map() } },
    guild: {
      channels: {
        fetch: mocks.guildChannelsFetch,
      },
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticket reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txUpdateValues.length = 0;
    mocks.txInsertValues.length = 0;
    mocks.db.insert.mockReturnValue(playerUpsert([actorPlayer]));
    mocks.db.select.mockReturnValue(selectLimit([closedTicket]));
    mocks.db.transaction.mockImplementation(transactionHarness());
    mocks.isStaff.mockResolvedValue(true);
    mocks.guildChannelsFetch.mockResolvedValue({
      isTextBased: () => true,
      setArchived: mocks.threadSetArchived,
      setLocked: mocks.threadSetLocked,
      send: mocks.threadSend,
    });
  });

  it('moves a closed ticket back to open and reopens its Discord thread', async () => {
    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.txUpdateValues).toContainEqual(expect.objectContaining({
      status: 'open',
      closedAt: null,
      resolvedAt: null,
    }));
    expect(mocks.txInsertValues).toContainEqual(expect.objectContaining({
      ticketId: closedTicket.id,
      actorId: actorPlayer.id,
      action: 'reopened',
      oldValue: 'closed',
      newValue: 'open',
    }));
    expect(mocks.txInsertValues).toContainEqual(expect.objectContaining({
      ticketId: closedTicket.id,
      authorId: actorPlayer.id,
      content: '**Reopened:** New evidence came in.',
      isInternal: false,
    }));
    expect(mocks.threadSetArchived).toHaveBeenCalledWith(false, 'Ticket #42 reopened');
    expect(mocks.threadSetLocked).toHaveBeenCalledWith(false, 'Ticket #42 reopened');
    expect(mocks.threadSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      allowedMentions: { parse: [] },
    }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  it('rejects users who are neither staff nor the ticket creator', async () => {
    mocks.isStaff.mockResolvedValue(false);
    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.threadSetArchived).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
    const embedDescription = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(embedDescription).toContain('Only the ticket creator or a staff member');
  });
});
