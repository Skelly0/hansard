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

    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await guild.commands.set(commandData);
        console.log(`Registered ${commandData.length} commands in ${guild.name}`);
      } catch (err) {
        console.error(`Failed to register commands in ${guild.name}:`, err);
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
