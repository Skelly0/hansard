import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Collection } from 'discord.js';
import type { Command } from './client.js';

function isRuntimeCommandFile(fileName: string): boolean {
  return /\.(?:t|j)s$/.test(fileName) && !/\.(?:test|spec)\.(?:t|j)s$/.test(fileName);
}

/** Recursively collect all .ts/.js command files from a directory. */
export function collectCommandFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...collectCommandFiles(fullPath));
    } else if (isRuntimeCommandFile(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

export function toCommandModuleSpecifier(filePath: string): string {
  return pathToFileURL(filePath).href;
}

/** Dynamically load all command modules from the commands directory. */
export async function loadCommands(
  commandsDir: string,
  commands: Collection<string, Command>,
): Promise<void> {
  const commandFiles = collectCommandFiles(commandsDir);
  const loadedCommandFiles = new Map<string, string>();

  for (const filePath of commandFiles) {
    const module = (await import(toCommandModuleSpecifier(filePath))) as { default: Command };
    const command = module.default;

    if (!command?.data?.name) {
      console.warn(`Skipping ${filePath} - no valid command export found.`);
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
