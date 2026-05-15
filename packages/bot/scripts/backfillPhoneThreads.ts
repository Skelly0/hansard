#!/usr/bin/env tsx
/**
 * One-shot replay of historic phone calls into per-pair staff threads under
 * PHONE_LOG_CHANNEL_ID. See
 * docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md.
 *
 *   --dry-run    Print counts without writing Discord or DB.
 *   --limit N    Stop after backfilling N calls (smoke-test mode).
 *   --verbose    Print per-send progress every 50 sends.
 */
import { Client, GatewayIntentBits, PermissionFlagsBits, type TextChannel } from 'discord.js';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';

export interface BackfillOptions {
  client: import('discord.js').Client;
  dryRun: boolean;
  limit: number | undefined;
  verbose: boolean;
}

const REQUIRED_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['CreatePrivateThreads', PermissionFlagsBits.CreatePrivateThreads],
  ['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads],
] as const;

export async function preflight(client: import('discord.js').Client): Promise<TextChannel> {
  const channelId = process.env[PHONE_LOG_CHANNEL_ENV]?.trim();
  if (!channelId) {
    throw new Error(`${PHONE_LOG_CHANNEL_ENV} is not set`);
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== 0) {
    throw new Error(`${PHONE_LOG_CHANNEL_ENV} (${channelId}) is not a guild text channel`);
  }
  const text = channel as TextChannel;
  const me = client.user;
  if (!me) throw new Error('client.user is null — bot not logged in');
  const perms = text.permissionsFor(me);
  if (!perms) throw new Error(`Could not resolve bot permissions in <#${channelId}>`);
  const missing = REQUIRED_PERMS.filter(([, flag]) => !perms.has(flag));
  if (missing.length > 0) {
    throw new Error(
      `Bot is missing ${missing.map((m) => m[0]).join(', ')} in <#${channelId}>`,
    );
  }
  return text;
}

export async function runBackfill(opts: BackfillOptions): Promise<void> {
  const channel = await preflight(opts.client);
  // The full pipeline is implemented in later tasks. For now, this scaffold
  // ensures the preflight gate trips before any DB or Discord writes.
  void channel;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;
  if (limitIdx >= 0 && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    console.error('--limit requires a positive integer');
    process.exit(2);
  }

  if (!process.env.DISCORD_BOT_TOKEN && !dryRun) {
    console.error('DISCORD_BOT_TOKEN is not set');
    process.exit(2);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  try {
    if (!dryRun) {
      await client.login(process.env.DISCORD_BOT_TOKEN);
    }
    await runBackfill({ client, dryRun, limit, verbose });
  } finally {
    await client.destroy();
  }
}

// Only auto-run when invoked directly (allow imports from tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
