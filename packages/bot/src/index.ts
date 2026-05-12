import 'dotenv/config';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, commands } from './client.js';
import { loadCommands } from './commandLoader.js';
import { registerReadyEvent } from './events/ready.js';
import { registerInteractionCreateEvent } from './events/interactionCreate.js';
import { registerMessageReactionAddEvent } from './events/messageReactionAdd.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Main boot sequence. */
async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    console.error('DISCORD_BOT_TOKEN is not set. Exiting.');
    process.exit(1);
  }

  // Register event handlers
  registerReadyEvent(client);
  registerInteractionCreateEvent(client);
  registerMessageReactionAddEvent(client);
  registerMessageCreateEvent(client);

  // Load commands
  await loadCommands(join(__dirname, 'commands'), commands);

  // Login
  await client.login(token);
}

// Graceful shutdown
function shutdown(signal: string): void {
  const botName = process.env.BOT_DISPLAY_NAME || 'Hansard';
  console.log(`\n${botName} received ${signal}. Shutting down gracefully...`);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Catch unhandled errors so the bot doesn't silently die
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
