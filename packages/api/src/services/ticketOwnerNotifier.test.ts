import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyTicketOwnerOfReply } from './ticketOwnerNotifier.js';

const originalFetch = globalThis.fetch;

function makeDb(rows: unknown[][]) {
  const queue = [...rows];
  const limit = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

describe('notifyTicketOwnerOfReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    delete process.env.TICKET_THREAD_MIRROR_BOT_TOKEN;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/users/@me/channels')) {
        return new Response(JSON.stringify({ id: 'dm-channel-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'sent-message-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.TICKET_THREAD_MIRROR_BOT_TOKEN;
  });

  it('opens a DM and sends the ticket reply to the ticket creator', async () => {
    const db = makeDb([
      [{ id: 'owner-id', discordId: 'owner-discord-id' }],
      [{ id: 'staff-id', characterName: 'Staff Character', discordUsername: 'Staffer' }],
    ]);

    await notifyTicketOwnerOfReply({
      db: db as any,
      ticket: {
        id: 'ticket-1',
        number: 42,
        title: 'Favourite transfer',
        createdById: 'owner-id',
      },
      authorId: 'staff-id',
      content: 'Yes, that transfer can go ahead.',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/users/@me/channels',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bot bot-token' }),
        body: JSON.stringify({ recipient_id: 'owner-discord-id' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/dm-channel-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bot bot-token' }),
        body: expect.stringContaining('Yes, that transfer can go ahead.'),
      }),
    );
  });

  it('does not DM the creator for their own reply', async () => {
    const db = makeDb([]);

    await notifyTicketOwnerOfReply({
      db: db as any,
      ticket: {
        id: 'ticket-1',
        number: 42,
        title: 'Favourite transfer',
        createdById: 'owner-id',
      },
      authorId: 'owner-id',
      content: 'Thanks',
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
