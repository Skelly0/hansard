import { Events, type Client } from 'discord.js';
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

    // Global registration is required for `setContexts(...BotDM)` to be honored — Discord
    // ignores the contexts array on guild-scoped commands. Without this, `/phone hangup`
    // and other DM-context features silently don't work from a DM.
    //
    // Tradeoff: global commands take up to ~1 hour to propagate vs near-instant for guild
    // commands. For dev iteration, set `DEV_GUILD_ID` and the bot will *also* register
    // every command to that guild for instant updates (duplicates are fine — Discord shows
    // the guild copy with no propagation delay).
    try {
      await readyClient.application?.commands.set(commandData);
      console.log(`Registered ${commandData.length} global commands`);
    } catch (err) {
      console.error('Failed to register global commands:', err);
    }

    const devGuildId = process.env.DEV_GUILD_ID?.trim();
    if (devGuildId) {
      const devGuild = readyClient.guilds.cache.get(devGuildId);
      if (devGuild) {
        try {
          await devGuild.commands.set(commandData);
          console.log(`Registered ${commandData.length} dev-guild commands in ${devGuild.name}`);
        } catch (err) {
          console.error(`Failed to register dev-guild commands in ${devGuild.name}:`, err);
        }
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
      voteAutoCloseWorker = startVoteAutoCloseWorker(db, {
        renderReactionResult,
        logger: console,
      });
      console.log('Vote auto-close worker started');
    }

    if (!phoneRingTimeoutWorker) {
      phoneRingTimeoutWorker = startPhoneRingTimeoutWorker(db, {
        client: readyClient,
        logger: console,
      });
      console.log('Phone ring-timeout worker started');
    }
  });
}
