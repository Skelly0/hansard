import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const mocks = vi.hoisted(() => ({
  client: {
    once: vi.fn(),
    login: vi.fn(),
    destroy: vi.fn(),
  },
  postPartyJoinMessage: vi.fn(),
}));

vi.mock('../client.js', () => ({
  client: mocks.client,
}));

vi.mock('../utils/partyJoinMessage.js', () => ({
  DEFAULT_PARTY_JOIN_CHANNEL_ID: '1501608247411609646',
  postPartyJoinMessage: mocks.postPartyJoinMessage,
}));

describe('postPartyJoinMessage script runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    delete process.env.PARTY_JOIN_CHANNEL_ID;
    mocks.client.login.mockResolvedValue(undefined);
  });

  it('rejects and destroys the client when posting fails after login', async () => {
    let readyHandler: (() => Promise<void>) | undefined;
    mocks.client.once.mockImplementation((event, handler) => {
      if (event === Events.ClientReady) readyHandler = handler;
      return mocks.client;
    });
    mocks.postPartyJoinMessage.mockRejectedValue(new Error('cannot post'));

    const { runPostPartyJoinMessageScript } = await import('./postPartyJoinMessage');
    expect(typeof runPostPartyJoinMessageScript).toBe('function');

    const logger = { log: vi.fn(), error: vi.fn() };
    const run = runPostPartyJoinMessageScript(mocks.client as any, logger as any);
    await readyHandler?.();

    await expect(run).rejects.toThrow('cannot post');
    expect(mocks.client.destroy).toHaveBeenCalledOnce();
  });
});
