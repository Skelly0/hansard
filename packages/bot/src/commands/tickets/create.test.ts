import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextChannel } from 'discord.js';
import command from './create.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
  },
  sendTicketStaffPing: vi.fn(),
  threadSend: vi.fn(),
  threadPin: vi.fn(),
  guildChannelsFetch: vi.fn(),
  updateSetValues: [] as Record<string, unknown>[],
  txInsertedValues: [] as Record<string, unknown>[],
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/ticketStaffPing.js', () => ({
  sendTicketStaffPing: mocks.sendTicketStaffPing,
}));

const category = {
  id: 'appeals-category-id',
  name: 'Appeals',
  description: 'Appeal a moderation action',
  emoji: '📋',
  isActive: true,
  sortOrder: 1,
};

const creator = {
  id: 'player-1',
  discordId: 'discord-user-1',
  discordUsername: 'TicketRaiser',
};

const ticketRow = {
  id: 'ticket-1',
  number: 42,
  status: 'open',
  priority: 'normal',
  createdAt: new Date('2026-05-10T20:00:00.000Z'),
};

function selectActiveCategories(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function playerUpsert(result: unknown[]) {
  return {
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(result),
      })),
    })),
  };
}

function updateQuery() {
  return {
    set: vi.fn((values) => {
      mocks.updateSetValues.push(values);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }),
  };
}

function transactionInsertSequence() {
  let insertIndex = 0;

  return async (callback: (tx: { insert: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const tx = {
      insert: vi.fn(() => {
        const currentInsert = ++insertIndex;

        return {
          values: vi.fn((values) => {
            mocks.txInsertedValues.push(values);

            if (currentInsert === 1) {
              return {
                returning: vi.fn().mockResolvedValue([ticketRow]),
              };
            }

            return Promise.resolve([]);
          }),
        };
      }),
    };

    return callback(tx);
  };
}

function makeInteraction() {
  const modalInteraction = {
    user: {
      id: creator.discordId,
      username: creator.discordUsername,
      displayName: 'Ticket Raiser',
    },
    member: {
      displayName: 'Ticket Raiser',
    },
    fields: {
      getTextInputValue: vi.fn((field: string) => {
        if (field === 'ticket_title') return 'Missing thread messages';
        if (field === 'ticket_description') return 'The ticket thread is empty after creation.';
        return '';
      }),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };

  const categoryInteraction = {
    user: { id: creator.discordId },
    values: [category.id],
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    awaitModalSubmit: vi.fn().mockResolvedValue(modalInteraction),
  };

  const reply = {
    awaitMessageComponent: vi.fn().mockResolvedValue(categoryInteraction),
  };

  return {
    options: {
      getSubcommand: vi.fn().mockReturnValue('create'),
    },
    user: {
      id: creator.discordId,
      username: creator.discordUsername,
      displayName: 'Ticket Raiser',
    },
    guild: {
      channels: {
        fetch: mocks.guildChannelsFetch,
      },
      roles: {
        cache: {
          find: vi.fn(),
          values: vi.fn(function* noRoles() {}),
        },
        fetch: vi.fn().mockResolvedValue({
          find: vi.fn(),
          values: vi.fn(function* noRoles() {}),
        }),
      },
    },
    reply: vi.fn().mockResolvedValue(reply),
    editReply: vi.fn().mockResolvedValue(undefined),
    modalInteraction,
  };
}

describe('/ticket command definition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSetValues.length = 0;
    mocks.txInsertedValues.length = 0;
    mocks.db.select.mockReturnValue(selectActiveCategories([category]));
    mocks.db.insert.mockReturnValue(playerUpsert([creator]));
    mocks.db.transaction.mockImplementation(transactionInsertSequence());
    mocks.db.update.mockReturnValue(updateQuery());
    mocks.sendTicketStaffPing.mockResolvedValue(undefined);
    process.env.TICKET_CHANNEL_ID = 'ticket-channel-id';
  });

  it('exposes category management under the existing ticket command', () => {
    const commandJson = command.data.toJSON();
    const subcommandNames = commandJson.options?.map((option) => option.name);

    expect(subcommandNames).toContain('create');
    expect(subcommandNames).toContain('categories');
    expect(subcommandNames).toContain('category-create');
  });

  it('posts the ticket summary and opener without adding the creator to the text thread', async () => {
    const threadMembersAdd = vi.fn();
    const textThreadsCreate = vi.fn().mockResolvedValue({
      id: 'text-thread-id',
      send: mocks.threadSend,
      members: {
        add: threadMembersAdd,
      },
    });
    const textChannel = {
      id: 'ticket-channel-id',
      threads: {
        create: textThreadsCreate,
      },
    };
    Object.setPrototypeOf(textChannel, TextChannel.prototype);
    mocks.guildChannelsFetch.mockResolvedValue(textChannel);
    mocks.threadSend
      .mockResolvedValueOnce({ id: 'summary-message-id', pin: mocks.threadPin })
      .mockResolvedValueOnce({ id: 'opening-message-id' });
    mocks.threadPin.mockResolvedValue(undefined);

    const interaction = makeInteraction();

    await command.execute(interaction as any);

    expect(textThreadsCreate).toHaveBeenCalledTimes(1);
    expect(threadMembersAdd).not.toHaveBeenCalled();
    expect(mocks.threadSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
    expect(mocks.threadSend).toHaveBeenCalledWith({
      content: '**Ticket Raiser** opened this ticket:\n\nThe ticket thread is empty after creation.',
      allowedMentions: { parse: [] },
    });
    expect(mocks.updateSetValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          discordThreadId: 'text-thread-id',
          discordChannelId: 'ticket-channel-id',
        }),
      ]),
    );
  });

  it('suppresses mentions when posting user-controlled ticket bodies to the thread', async () => {
    const threadMembersAdd = vi.fn();
    const textThreadsCreate = vi.fn().mockResolvedValue({
      id: 'text-thread-id',
      send: mocks.threadSend,
      members: {
        add: threadMembersAdd,
      },
    });
    const textChannel = {
      id: 'ticket-channel-id',
      threads: {
        create: textThreadsCreate,
      },
    };
    Object.setPrototypeOf(textChannel, TextChannel.prototype);
    mocks.guildChannelsFetch.mockResolvedValue(textChannel);
    mocks.threadSend
      .mockResolvedValueOnce({ id: 'summary-message-id', pin: mocks.threadPin })
      .mockResolvedValueOnce({ id: 'opening-message-id' });
    mocks.threadPin.mockResolvedValue(undefined);

    const interaction = makeInteraction();

    await command.execute(interaction as any);

    // Every user-controlled body posted to the thread (summary embeds carry the
    // creator's description; opener echoes it verbatim) must suppress mentions
    // so a creator cannot @everyone or @<staff role> through the bot token.
    const summaryCall = mocks.threadSend.mock.calls.find(
      ([arg]: [unknown]) =>
        typeof arg === 'object' && arg !== null && 'embeds' in (arg as Record<string, unknown>),
    );
    expect(summaryCall?.[0]).toMatchObject({
      allowedMentions: { parse: [] },
    });

    const openerCall = mocks.threadSend.mock.calls.find(
      ([arg]: [unknown]) =>
        typeof arg === 'object' &&
        arg !== null &&
        'content' in (arg as Record<string, unknown>) &&
        !('embeds' in (arg as Record<string, unknown>)),
    );
    expect(openerCall?.[0]).toMatchObject({
      allowedMentions: { parse: [] },
    });
  });
});
