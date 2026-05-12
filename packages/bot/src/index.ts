import 'dotenv/config';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, commands } from './client.js';
import { loadCommands } from './commandLoader.js';
import { registerReadyEvent, stopBackgroundWorkers } from './events/ready.js';
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

// Graceful shutdown. Stop the background workers first so a SIGTERM landing mid-tick can't
// tear down an in-flight DB op; then give the runtime a brief moment to flush the final
// state before destroying the gateway connection.
let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  const botName = process.env.BOT_DISPLAY_NAME || 'Hansard';
  console.log(`\n${botName} received ${signal}. Shutting down gracefully...`);
  try {
    stopBackgroundWorkers();
  } catch (err) {
    console.error('Error stopping background workers:', err);
  }
  // Give any pending writes (worker ticks, in-flight relays) a short window to settle.
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    client.destroy();
  } catch (err) {
    console.error('Error destroying client:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

// Catch unhandled errors so the bot doesn't silently die
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
