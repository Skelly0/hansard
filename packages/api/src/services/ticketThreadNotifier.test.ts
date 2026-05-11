import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadNotifier() {
  vi.resetModules();
  return import('./ticketThreadNotifier.js');
}

describe('postToTicketThread token configuration', () => {
  afterEach(() => {
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.TICKET_THREAD_MIRROR_BOT_TOKEN;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the API-local ticket thread mirror token when the bot runtime token is absent', async () => {
    process.env.TICKET_THREAD_MIRROR_BOT_TOKEN = 'mirror-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { postToTicketThread } = await loadNotifier();
    await postToTicketThread({
      threadId: 'thread-123',
      content: 'Ticket updated',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/thread-123/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bot mirror-token',
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({
        content: 'Ticket updated',
        allowed_mentions: { parse: [] },
      }),
    );
  });

  it('suppresses Discord mentions on mirrored ticket content', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { postToTicketThread } = await loadNotifier();
    await postToTicketThread({
      threadId: 'thread-123',
      content: '@everyone <@123> <@&456> please read this',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({
        content: '@everyone <@123> <@&456> please read this',
        allowed_mentions: { parse: [] },
      }),
    );
  });

  it('suppresses Discord mentions on embed-only mirror posts', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { postToTicketThread } = await loadNotifier();
    await postToTicketThread({
      threadId: 'thread-123',
      embeds: [
        {
          title: 'Ticket updated',
          description: '@everyone <@123> <@&456>',
        },
      ],
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({
        allowed_mentions: { parse: [] },
      }),
    );
  });

  it('warns once when a thread update cannot be mirrored because no token is configured', async () => {
    const fetchMock = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    const { postToTicketThread } = await loadNotifier();
    await postToTicketThread({
      threadId: 'thread-123',
      content: 'Ticket updated',
    });
    await postToTicketThread({
      threadId: 'thread-123',
      content: 'Ticket updated again',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TICKET_THREAD_MIRROR_BOT_TOKEN'),
    );
  });
});
