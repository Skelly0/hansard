import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postApiStaffActionLog } from './modLogService.js';

describe('postApiStaffActionLog', () => {
  const originalEnv = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    MOD_LOG_BOT_TOKEN: process.env.MOD_LOG_BOT_TOKEN,
    MOD_LOG_CHANNEL_ID: process.env.MOD_LOG_CHANNEL_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.MOD_LOG_BOT_TOKEN;
    delete process.env.MOD_LOG_CHANNEL_ID;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('posts a Discord embed for successful web/API staff actions', async () => {
    process.env.MOD_LOG_CHANNEL_ID = 'mod-log-channel';
    process.env.DISCORD_BOT_TOKEN = 'bot-token';

    await postApiStaffActionLog({
      actor: {
        id: 'staff-player',
        discordId: 'discord-staff',
        discordUsername: 'Skell',
        characterName: 'Minister Prime',
      },
      method: 'POST',
      path: '/api/favours/grant',
      statusCode: 200,
      payload: { playerId: 'target-player', amount: 5, reason: 'helped the crown' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/mod-log-channel/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bot bot-token',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].fields).toEqual(expect.arrayContaining([
      { name: 'Actor', value: '**Minister Prime** (<@discord-staff>)', inline: true },
      { name: 'Route', value: '`POST /api/favours/grant`', inline: true },
      { name: 'Status', value: '`200`', inline: true },
      expect.objectContaining({
        name: 'Payload',
        value: expect.stringContaining('amount=5'),
      }),
    ]));
  });

  it('is a no-op without mod-log configuration', async () => {
    await postApiStaffActionLog({
      method: 'POST',
      path: '/api/favours/grant',
      statusCode: 200,
      payload: { amount: 5 },
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
