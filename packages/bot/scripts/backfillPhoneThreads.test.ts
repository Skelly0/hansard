import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { runBackfill } from './backfillPhoneThreads';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetAllMocks();
});

function makeChannel(perms: bigint) {
  return {
    type: 0, // ChannelType.GuildText
    permissionsFor: vi.fn().mockReturnValue({ has: (flag: bigint) => (perms & flag) === flag }),
    threads: { create: vi.fn() },
    send: vi.fn(),
  };
}

function makeClient(channel: ReturnType<typeof makeChannel>) {
  return {
    user: { id: 'BOT' },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    guilds: { cache: new Map() },
    destroy: vi.fn(),
  } as unknown as import('discord.js').Client;
}

describe('backfillPhoneThreads — preflight', () => {
  it('aborts before any DB writes when CreatePrivateThreads is missing', async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    const channel = makeChannel(
      PermissionFlagsBits.ViewChannel
      | PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.SendMessagesInThreads,
      // CreatePrivateThreads omitted
    );
    const client = makeClient(channel);

    await expect(runBackfill({
      client,
      dryRun: false,
      limit: undefined,
      verbose: false,
    })).rejects.toThrow(/CreatePrivateThreads/);
  });
});
