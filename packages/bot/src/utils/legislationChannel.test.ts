import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import {
  DEFAULT_LEGISLATION_CHANNEL_ID,
  getLegislationChannelId,
  postLegislationEmbed,
} from './legislationChannel.js';

describe('legislation channel posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEGISLATION_CHANNEL_ID;
  });

  it('uses the SCORP3 legislation channel when no env override is configured', () => {
    expect(getLegislationChannelId()).toBe(DEFAULT_LEGISLATION_CHANNEL_ID);
  });

  it('prefers a trimmed LEGISLATION_CHANNEL_ID env override', () => {
    process.env.LEGISLATION_CHANNEL_ID = ' 123456789012345678 ';

    expect(getLegislationChannelId()).toBe('123456789012345678');
  });

  it('posts embeds to the configured legislation channel', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });
    const embed = new EmbedBuilder().setTitle('Bill Enacted');

    const result = await postLegislationEmbed({
      client: { channels: { fetch } },
      embed,
    });

    expect(fetch).toHaveBeenCalledWith(DEFAULT_LEGISLATION_CHANNEL_ID);
    expect(send).toHaveBeenCalledWith({ embeds: [embed] });
    expect(result).toMatchObject({
      status: 'sent',
      channelId: DEFAULT_LEGISLATION_CHANNEL_ID,
    });
  });
});
