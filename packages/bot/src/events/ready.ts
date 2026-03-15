import { Events, type Client } from 'discord.js';

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    const botName = process.env.BOT_DISPLAY_NAME || 'Hansard';
    const guildCount = readyClient.guilds.cache.size;
    console.log(`${botName} is online! Serving ${guildCount} guild(s)`);
  });
}
