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
  resolvePartyJoinChannelId: () => process.env.PARTY_JOIN_CHANNEL_ID?.trim() || null,
  postPartyJoinMessage: mocks.postPartyJoinMessage,
}));

describe('postPartyJoinMessage script runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.PARTY_JOIN_CHANNEL_ID = '123456789012345678';
    mocks.client.login.mockResolvedValue(undefined);
  });

  it('refuses to run when PARTY_JOIN_CHANNEL_ID is unset', async () => {
    delete process.env.PARTY_JOIN_CHANNEL_ID;

    const { runPostPartyJoinMessageScript } = await import('./postPartyJoinMessage');

    await expect(runPostPartyJoinMessageScript(mocks.client as any)).rejects.toThrow('PARTY_JOIN_CHANNEL_ID is not set.');
    expect(mocks.client.login).not.toHaveBeenCalled();
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
