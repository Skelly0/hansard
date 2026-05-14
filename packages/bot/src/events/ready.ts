import { Events, type Client } from 'discord.js';
import { VoteService } from '@hansard/api/services/voteService';
import { commands } from '../client.js';
import { db } from '../db.js';
import { renderReactionResult } from '../commands/vote/close.js';
import { startVoteAutoCloseWorker } from '../services/voteAutoClose.js';
import { startPhoneRingTimeoutWorker } from '../services/phoneRingTimeout.js';

let voteAutoCloseWorker: NodeJS.Timeout | null = null;
let phoneRingTimeoutWorker: NodeJS.Timeout | null = null;

/**
 * Stop all background workers. Called from the shutdown handler so a SIGTERM doesn't
 * tear down an in-flight DB write mid-tick.
 */
export function stopBackgroundWorkers(): void {
  if (voteAutoCloseWorker) {
    clearInterval(voteAutoCloseWorker);
    voteAutoCloseWorker = null;
  }
  if (phoneRingTimeoutWorker) {
    clearInterval(phoneRingTimeoutWorker);
    phoneRingTimeoutWorker = null;
  }
}

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    const botName = process.env.BOT_DISPLAY_NAME || 'Hansard';
    const guildCount = readyClient.guilds.cache.size;
    console.log(`${botName} is online! Serving ${guildCount} guild(s)`);

    const commandData = [...commands.values()].map((c) => c.data.toJSON());
    const globalCommandData = commandData.filter((command) => command.name === 'phone');
    const guildCommandData = commandData.filter((command) => command.name !== 'phone');

    // Only /phone needs a global command because BotDM contexts are ignored for guild-scoped
    // registrations. Keep every other command guild-scoped so guild-only permission metadata
    // cannot be bypassed from DMs.
    try {
      await readyClient.application?.commands.set(globalCommandData);
      console.log(`Registered ${globalCommandData.length} global command(s)`);
    } catch (err) {
      console.error('Failed to register global commands:', err);
    }

    // Preserve the old production behavior of sweeping guild command sets. Excludes /phone
    // (registered globally above) — including it here too would register it twice, so it
    // shows up duplicated in every guild's command picker. The sweep also deletes stale
    // guild commands such as /time-history and any previously guild-scoped /phone.
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await guild.commands.set(guildCommandData);
        console.log(`Registered ${guildCommandData.length} guild commands in ${guild.name}`);
      } catch (err) {
        console.error(`Failed to register guild commands in ${guild.name}:`, err);
      }
    }

    const devGuildId = process.env.DEV_GUILD_ID?.trim();
    if (devGuildId) {
      const devGuild = readyClient.guilds.cache.get(devGuildId);
      if (devGuild) {
        console.log(`DEV_GUILD_ID=${devGuildId} is included in the guild command sweep (${devGuild.name})`);
      } else {
        console.warn(`DEV_GUILD_ID=${devGuildId} not in cache — skipping dev-guild registration`);
      }
    }

    // Startup check: warn loudly if PHONE_GUILD_ID is unset but the bot is in multiple guilds.
    // The phone log/tap channels resolve to client.guilds.cache.first() otherwise, which is
    // non-deterministic across shard ready order.
    if (readyClient.guilds.cache.size > 1 && !process.env.PHONE_GUILD_ID?.trim()) {
      console.warn(`[phone:ready] Bot is in ${readyClient.guilds.cache.size} guilds but PHONE_GUILD_ID is unset; staff thread creation will use an arbitrary guild`);
    }

    // Startup check: warn if PHONE_LOG_CHANNEL_ID resolves to a channel where @everyone has
    // ViewChannel — phone log threads inherit the parent's read membership for the thread
    // name and creation events.
    const phoneLogChannelId = process.env.PHONE_LOG_CHANNEL_ID?.trim();
    if (phoneLogChannelId) {
      try {
        const channel = await readyClient.channels.fetch(phoneLogChannelId);
        if (channel && 'guild' in channel && 'permissionsFor' in channel) {
          const everyone = channel.guild.roles.everyone;
          if (channel.permissionsFor(everyone)?.has('ViewChannel')) {
            console.warn(`[phone:ready] PHONE_LOG_CHANNEL_ID=${phoneLogChannelId} is visible to @everyone — phone log thread names will leak. Make it a staff-only channel.`);
          }
        }
      } catch (err) {
        console.error('[phone:ready] failed to validate PHONE_LOG_CHANNEL_ID visibility:', err);
      }
    }

    if (!voteAutoCloseWorker) {
      const voteService = new VoteService(db);
      voteAutoCloseWorker = startVoteAutoCloseWorker(db, {
        renderReactionResult,
        tallyElection: async (election) => {
          await voteService.tallyVotes(election.id);
        },
        logger: console,
      });
      console.log('Vote auto-close worker started');
    }

    // Leader election for the ring-timeout worker. Across a sharded deployment (or restart
    // overlap) every shard runs this ready handler, and two timers expiring the same call
    // would DM both parties twice. Gate the worker to shard 0 when sharded; unsharded
    // single-process deployments have no `client.shard`, so they still start it.
    const isWorkerLeader = !readyClient.shard || readyClient.shard.ids.includes(0);
    if (!phoneRingTimeoutWorker && isWorkerLeader) {
      phoneRingTimeoutWorker = startPhoneRingTimeoutWorker(db, {
        client: readyClient,
        logger: console,
      });
      console.log('Phone ring-timeout worker started');
    } else if (!isWorkerLeader) {
      console.log('Phone ring-timeout worker skipped on non-leader shard');
    }
  });
}
