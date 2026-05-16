import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { Events, type Client } from 'discord.js';
import { client } from '../client.js';
import { DEFAULT_PARTY_JOIN_CHANNEL_ID, postPartyJoinMessage } from '../utils/partyJoinMessage.js';

export async function runPostPartyJoinMessageScript(
  botClient: Client = client,
  logger: Pick<Console, 'log' | 'error'> = console,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set.');
  }

  const channelId = process.env.PARTY_JOIN_CHANNEL_ID || DEFAULT_PARTY_JOIN_CHANNEL_ID;

  await new Promise<void>((resolve, reject) => {
    botClient.once(Events.ClientReady, async () => {
      try {
        const message = await postPartyJoinMessage(botClient, channelId);
        logger.log(`Posted party join message ${message.id} in channel ${channelId}`);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        botClient.destroy();
      }
    });

    botClient.login(token).catch((error) => {
      botClient.destroy();
      reject(error);
    });
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  runPostPartyJoinMessageScript().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
