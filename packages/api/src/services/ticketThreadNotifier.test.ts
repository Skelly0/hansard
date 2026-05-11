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
