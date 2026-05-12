import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { Events, type Client } from 'discord.js';
import { client } from '../client.js';
import { refreshPartyJoinMessage } from '../utils/partyJoinMessage.js';

const CLIENT_READY_TIMEOUT_MS = 120_000;
const REFRESH_TIMEOUT_MS = 90_000;

function reactionEmojisFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];

  return description
    .split('\n')
    .map((line) => line.trimStart().match(/^(\S+)\s+\*\*/)?.[1])
    .filter((emoji): emoji is string => Boolean(emoji));
}

export async function runRefreshPartyJoinMessageScript(
  botClient: Client = client,
  logger: Pick<Console, 'log' | 'error'> = console,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set.');
  }

  await new Promise<void>((resolve, reject) => {
    const readyTimeout = setTimeout(() => {
      botClient.destroy();
      reject(new Error('Timed out waiting for Discord client ready.'));
    }, CLIENT_READY_TIMEOUT_MS);

    botClient.once(Events.ClientReady, async () => {
      clearTimeout(readyTimeout);
      logger.log('Discord client ready; refreshing party join board.');

      let refreshTimeout: NodeJS.Timeout | null = null;
      try {
        const message = await Promise.race([
          refreshPartyJoinMessage(botClient),
          new Promise<never>((_, refreshReject) => {
            refreshTimeout = setTimeout(() => {
              refreshReject(new Error('Timed out refreshing party join board.'));
            }, REFRESH_TIMEOUT_MS);
          }),
        ]);
        if (!message) {
          throw new Error('No current party join board was found.');
        }

        const emojis = reactionEmojisFromDescription(message.embeds[0]?.description);
        logger.log(`Refreshed party join message ${message.id} in channel ${message.channelId}.`);
        logger.log(`Current seeded emojis: ${emojis.join(' ')}`);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        botClient.destroy();
      }
    });

    botClient.login(token).catch((error) => {
      clearTimeout(readyTimeout);
      botClient.destroy();
      reject(error);
    });
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  runRefreshPartyJoinMessageScript()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
