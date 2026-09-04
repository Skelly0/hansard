import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import {
  getGameEventsChannelId,
  postGameEventsEmbed,
} from './gameEventsChannel.js';

describe('game events channel posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GAME_EVENTS_CHANNEL_ID;
    delete process.env.ANNOUNCEMENT_CHANNEL_ID;
  });

  it('returns null when no game events channel is configured', () => {
    expect(getGameEventsChannelId()).toBeNull();
  });

  it('reports not_configured instead of posting when no channel is set', async () => {
    const fetch = vi.fn();

    const result = await postGameEventsEmbed({
      client: { channels: { fetch } },
      embed: new EmbedBuilder().setTitle('Time Advanced'),
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'not_configured', channelId: null });
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
    process.env.GAME_EVENTS_CHANNEL_ID = '123456789012345678';
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });
    const embed = new EmbedBuilder().setTitle('Time Advanced');

    const result = await postGameEventsEmbed({
      client: { channels: { fetch } },
      embed,
    });

    expect(fetch).toHaveBeenCalledWith('123456789012345678');
    expect(send).toHaveBeenCalledWith({ embeds: [embed] });
    expect(result).toMatchObject({
      status: 'sent',
      channelId: '123456789012345678',
    });
  });
});
