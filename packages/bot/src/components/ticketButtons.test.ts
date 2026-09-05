import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  isStaff: vi.fn(),
  postToTicketThread: vi.fn(),
}));

vi.mock('../db.js', () => ({ db: mocks.db }));
vi.mock('../utils/permissions.js', () => ({ isStaff: mocks.isStaff }));
vi.mock('@hansard/api/services/ticketThreadNotifier', () => ({
  postToTicketThread: mocks.postToTicketThread,
}));

import {
  TICKET_DESCRIPTION_PAGE_SIZE,
  buildTicketDescriptionEmbeds,
  buildTicketOpeningMessages,
  buildTicketSummaryEmbed,
  buildTicketSummaryEmbeds,
  handleTicketButton,
  resolveTicketThread,
} from './ticketButtons.js';

describe('buildTicketSummaryEmbed', () => {
  it('keeps the full ticket description in the summary embed', () => {
    const description = [
      'A'.repeat(401),
      'This final sentence should still be visible.',
    ].join('\n');

    const embed = buildTicketSummaryEmbed({
      number: 42,
      title: 'Long petition',
      description,
      category: { name: 'Appeals', emoji: 'A' },
      status: 'open',
      priority: 'normal',
      createdBy: { id: 'player-1', displayName: 'Ada' },
      assignedTo: null,
      createdAt: '2026-05-01T12:00:00.000Z',
      tags: [],
    });

    expect(embed.data.description).toBe(description);
  });

  it('splits long ticket descriptions into Discord-safe summary pages', () => {
    const description = `${'A'.repeat(TICKET_DESCRIPTION_PAGE_SIZE)}${'B'.repeat(50)}`;

    const pages = buildTicketSummaryEmbeds({
      number: 42,
      title: 'Long petition',
      description,
      category: { name: 'Appeals', emoji: 'A' },
      status: 'open',
      priority: 'normal',
      createdBy: { id: 'player-1', displayName: 'Ada' },
      assignedTo: null,
      createdAt: '2026-05-01T12:00:00.000Z',
      tags: [],
    });

    expect(pages).toHaveLength(2);
    expect(pages.every((page) => (page.data.description?.length ?? 0) <= TICKET_DESCRIPTION_PAGE_SIZE)).toBe(true);
    expect(pages.map((page) => page.data.description).join('')).toBe(description);
    expect(pages[0].data.fields).toBeDefined();
    expect(pages[1].data.fields).toBeUndefined();
    expect(pages[1].data.title).toContain('continued');
  });
});

describe('buildTicketDescriptionEmbeds', () => {
  it('keeps metadata fields only on the first ticket page', () => {
    const pages = buildTicketDescriptionEmbeds({
      title: 'Ticket #42: Long petition',
      description: `${'A'.repeat(TICKET_DESCRIPTION_PAGE_SIZE)}${'B'.repeat(50)}`,
      fields: [{ name: 'Status', value: 'Open', inline: true }],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].data.fields).toHaveLength(1);
    expect(pages[1].data.fields).toBeUndefined();
  });
});

describe('buildTicketOpeningMessages', () => {
  it('splits the thread opening message into Discord-safe chunks', () => {
    const messages = buildTicketOpeningMessages('Ada', `${'A'.repeat(1990)}${'B'.repeat(50)}`);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 2000)).toBe(true);
    expect(messages.join('').replace('**Ada** opened this ticket:\n\n', '')).toBe(`${'A'.repeat(1990)}${'B'.repeat(50)}`);
    expect(messages[0]).toMatch(/^\*\*Ada\*\* opened this ticket:/);
  });
});

function fakeThread(id: string) {
  return {
    id,
    type: ChannelType.PrivateThread,
    isThread: () => true,
    send: vi.fn().mockResolvedValue(undefined),
    setLocked: vi.fn().mockResolvedValue(undefined),
    messages: {
      fetchPinned: vi.fn().mockResolvedValue({ find: () => undefined }),
      fetch: vi.fn().mockResolvedValue({ find: () => undefined }),
    },
  };
}

describe('resolveTicketThread', () => {
  it("fetches the ticket's own thread rather than the interaction channel", async () => {
    const ticketThread = fakeThread('ticket-thread');
    const interaction = {
      channel: fakeThread('unrelated-thread'),
      client: { channels: { fetch: vi.fn().mockResolvedValue(ticketThread) } },
    };

    const thread = await resolveTicketThread(interaction as any, { discordThreadId: 'ticket-thread' });

    expect(interaction.client.channels.fetch).toHaveBeenCalledWith('ticket-thread');
    expect(thread).toBe(ticketThread);
  });

  it('returns null when the ticket has no thread on record', async () => {
    const interaction = {
      channel: fakeThread('unrelated-thread'),
      client: { channels: { fetch: vi.fn() } },
    };

    const thread = await resolveTicketThread(interaction as any, { discordThreadId: null });

    expect(thread).toBeNull();
    expect(interaction.client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns null when the recorded channel is not a thread', async () => {
    const interaction = {
      channel: fakeThread('unrelated-thread'),
      client: { channels: { fetch: vi.fn().mockResolvedValue({ id: 'text-channel', isThread: () => false }) } },
    };

    await expect(resolveTicketThread(interaction as any, { discordThreadId: 'text-channel' })).resolves.toBeNull();
  });
});

describe('ticket_close button', () => {
  const ticket = {
    id: 'ticket-uuid',
    number: 42,
    title: 'Broken portrait',
    description: 'My portrait will not upload.',
    status: 'open',
    priority: 'normal',
    createdById: 'player-1',
    assignedToId: null,
    categoryId: 'cat-1',
    discordThreadId: 'ticket-thread',
    createdAt: new Date('2026-05-01T12:00:00.000Z'),
    resolvedAt: null,
    tags: [],
  };

  function queueSelects(rowSets: unknown[][]) {
    mocks.db.select.mockImplementation(() => {
      const rows = rowSets.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      };
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(false);
    mocks.db.insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'player-1', discordId: 'discord-player' }]),
        })),
      })),
    });
    mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    }));
  });

  it("locks the ticket's own thread, never the thread the button was clicked in", async () => {
    const ticketThread = fakeThread('ticket-thread');
    const unrelatedThread = fakeThread('unrelated-thread');
    queueSelects([
      [ticket],                                                      // close: load ticket
      [ticket],                                                      // refreshPinnedSummary: ticket
      [{ id: 'cat-1', name: 'Bugs', emoji: '🐛' }],                  // refreshPinnedSummary: category
      [{ id: 'player-1', discordId: 'discord-player', characterName: 'Ada', discordUsername: 'ada' }],
    ]);
    const fetchChannel = vi.fn(async (id: string) => (id === 'ticket-thread' ? ticketThread : null));
    const interaction = {
      customId: 'ticket_close:42',
      user: { id: 'discord-player', username: 'ada', displayName: 'Ada' },
      member: { roles: [] },
      channel: unrelatedThread,
      guild: { channels: { fetch: fetchChannel } },
      client: { user: { id: 'bot-user' }, channels: { fetch: fetchChannel } },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
    };

    await handleTicketButton(interaction as any);

    expect(unrelatedThread.setLocked).not.toHaveBeenCalled();
    expect(unrelatedThread.send).not.toHaveBeenCalled();
    expect(ticketThread.setLocked).toHaveBeenCalledWith(true, expect.any(String));
    expect(ticketThread.send).toHaveBeenCalledTimes(1);
  });
});
