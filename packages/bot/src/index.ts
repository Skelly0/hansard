import 'dotenv/config';

import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { client, commands, type Command } from './client.js';
import { registerReadyEvent } from './events/ready.js';
import { registerInteractionCreateEvent } from './events/interactionCreate.js';
import { registerMessageReactionAddEvent } from './events/messageReactionAdd.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Recursively collect all .ts/.js files from a directory.
 */
function collectCommandFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...collectCommandFiles(fullPath));
    } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      results.push(fullPath);
    }
  }

  return results;
}

/** Dynamically load all command modules from the commands directory (recursively). */
async function loadCommands(): Promise<void> {
  const commandsDir = join(__dirname, 'commands');
  const commandFiles = collectCommandFiles(commandsDir);
  const loadedCommandFiles = new Map<string, string>();

  for (const filePath of commandFiles) {
    const module = (await import(pathToFileURL(filePath).href)) as { default: Command };
    const command = module.default;

    if (!command?.data?.name) {
      console.warn(`Skipping ${filePath} — no valid command export found.`);
      continue;
    }

    const commandName = command.data.name;
    const existingFile = loadedCommandFiles.get(commandName);
    if (existingFile) {
      throw new Error(
        `Duplicate command /${commandName} found in ${filePath}; already loaded from ${existingFile}.`,
      );
    }

    commands.set(commandName, command);
    loadedCommandFiles.set(commandName, filePath);
    console.log(`Loaded command: /${commandName}`);
  }
}

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

  // Load commands
  await loadCommands();

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
