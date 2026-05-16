import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import {
  DEFAULT_GAME_EVENTS_CHANNEL_ID,
  getGameEventsChannelId,
  postGameEventsEmbed,
} from './gameEventsChannel.js';

describe('game events channel posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GAME_EVENTS_CHANNEL_ID;
    delete process.env.ANNOUNCEMENT_CHANNEL_ID;
  });

  it('uses the SCORP3 game events channel when no env override is configured', () => {
    expect(getGameEventsChannelId()).toBe(DEFAULT_GAME_EVENTS_CHANNEL_ID);
  });

  it('prefers a trimmed GAME_EVENTS_CHANNEL_ID env override', () => {
    process.env.GAME_EVENTS_CHANNEL_ID = ' 123456789012345678 ';

    expect(getGameEventsChannelId()).toBe('123456789012345678');
  });

  it('falls back to the legacy ANNOUNCEMENT_CHANNEL_ID env var', () => {
    process.env.ANNOUNCEMENT_CHANNEL_ID = ' 234567890123456789 ';

    expect(getGameEventsChannelId()).toBe('234567890123456789');
  });

  it('posts embeds to the configured game events channel', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });
    const embed = new EmbedBuilder().setTitle('Time Advanced');

    const result = await postGameEventsEmbed({
      client: { channels: { fetch } },
      embed,
    });

    expect(fetch).toHaveBeenCalledWith(DEFAULT_GAME_EVENTS_CHANNEL_ID);
    expect(send).toHaveBeenCalledWith({ embeds: [embed] });
    expect(result).toMatchObject({
      status: 'sent',
      channelId: DEFAULT_GAME_EVENTS_CHANNEL_ID,
    });
  });
});
