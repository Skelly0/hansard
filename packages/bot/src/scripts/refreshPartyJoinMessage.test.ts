import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const mocks = vi.hoisted(() => ({
  client: {
    once: vi.fn(),
    login: vi.fn(),
    destroy: vi.fn(),
  },
  refreshPartyJoinMessage: vi.fn(),
}));

vi.mock('../client.js', () => ({
  client: mocks.client,
}));

vi.mock('../utils/partyJoinMessage.js', () => ({
  refreshPartyJoinMessage: mocks.refreshPartyJoinMessage,
}));

describe('refreshPartyJoinMessage script runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    mocks.client.login.mockResolvedValue(undefined);
  });

  it('refreshes the current join board after login and logs the seeded emojis', async () => {
    let readyHandler: (() => Promise<void>) | undefined;
    mocks.client.once.mockImplementation((event, handler) => {
      if (event === Events.ClientReady) readyHandler = handler;
      return mocks.client;
    });
    mocks.refreshPartyJoinMessage.mockResolvedValue({
      id: 'message-1',
      channelId: 'channel-1',
      embeds: [{
        description: [
          'React with the emoji for the open party you want to join.',
          '',
          '🔵 **Blue Party** (BLU) — Ideology: *Liberal conservatism*',
          '🟢 **Green Party** (GRN) — Ideology: *Ecologism*',
        ].join('\n'),
      }],
    });

    const { runRefreshPartyJoinMessageScript } = await import('./refreshPartyJoinMessage');
    const logger = { log: vi.fn(), error: vi.fn() };
    const run = runRefreshPartyJoinMessageScript(mocks.client as any, logger as any);
    await readyHandler?.();
    await run;

    expect(mocks.refreshPartyJoinMessage).toHaveBeenCalledWith(mocks.client);
    expect(logger.log).toHaveBeenCalledWith('Refreshed party join message message-1 in channel channel-1.');
    expect(logger.log).toHaveBeenCalledWith('Current seeded emojis: 🔵 🟢');
    expect(mocks.client.destroy).toHaveBeenCalledOnce();
  });
});
