import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postStaffActionLog } from './modLog.js';

describe('postStaffActionLog', () => {
  const originalChannelId = process.env.MOD_LOG_CHANNEL_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOD_LOG_CHANNEL_ID = 'mod-log-channel';
  });

  afterAll(() => {
    if (originalChannelId === undefined) {
      delete process.env.MOD_LOG_CHANNEL_ID;
    } else {
      process.env.MOD_LOG_CHANNEL_ID = originalChannelId;
    }
  });

  it('labels the actor generically because some logged actions are non-staff office powers', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: {
        id: 'discord-actor',
        toString: () => '<@discord-actor>',
      },
      client: {
        channels: {
          fetch: vi.fn().mockResolvedValue({ send }),
        },
      },
    };

    await postStaffActionLog(interaction as any, {
      title: 'Office Holder Appointed',
      system: 'offices',
      fields: [{ name: 'Office', value: 'Prime Minister', inline: true }],
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    const embedJson = payload.embeds[0].toJSON();
    expect(embedJson.fields[0]).toEqual({
      name: 'Actor',
      value: '<@discord-actor>',
      inline: true,
    });
  });
});
