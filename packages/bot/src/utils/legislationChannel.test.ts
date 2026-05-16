import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import {
  DEFAULT_LEGISLATION_CHANNEL_ID,
  editLegislationEmbed,
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
    const send = vi.fn().mockResolvedValue({ id: '987654321' });
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
      messageId: '987654321',
    });
  });

  it('returns a null messageId when the send response has no id', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });
    const embed = new EmbedBuilder().setTitle('Bill Enacted');

    const result = await postLegislationEmbed({
      client: { channels: { fetch } },
      embed,
    });

    expect(result).toMatchObject({
      status: 'sent',
      channelId: DEFAULT_LEGISLATION_CHANNEL_ID,
      messageId: null,
    });
  });
});

describe('legislation channel editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEGISLATION_CHANNEL_ID;
  });

  it('returns no_message when channelId or messageId is missing (legacy bill)', async () => {
    const fetch = vi.fn();
    const result = await editLegislationEmbed({
      client: { channels: { fetch } },
      embed: new EmbedBuilder().setTitle('Bill Repealed'),
      channelId: null,
      messageId: '123',
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'no_message' });
  });

  it('edits the stored message in place when ids are present', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const fetchMessage = vi.fn().mockResolvedValue({ edit });
    const send = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ send, messages: { fetch: fetchMessage } });
    const embed = new EmbedBuilder().setTitle('Bill Repealed');

    const result = await editLegislationEmbed({
      client: { channels: { fetch } },
      embed,
      channelId: 'chan-1',
      messageId: 'msg-1',
    });

    expect(fetch).toHaveBeenCalledWith('chan-1');
    expect(fetchMessage).toHaveBeenCalledWith('msg-1');
    expect(edit).toHaveBeenCalledWith({ embeds: [embed] });
    expect(result).toMatchObject({ status: 'edited', channelId: 'chan-1', messageId: 'msg-1' });
  });

  it('reports failed when the channel fetch throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const logger = { error: vi.fn() };

    const result = await editLegislationEmbed({
      client: { channels: { fetch } },
      embed: new EmbedBuilder(),
      channelId: 'chan-1',
      messageId: 'msg-1',
      logger,
    });

    expect(result.status).toBe('failed');
    expect(logger.error).toHaveBeenCalled();
  });
});
