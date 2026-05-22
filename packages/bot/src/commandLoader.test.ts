import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Command } from './client.js';
import { collectCommandFiles, loadCommands, toCommandModuleSpecifier } from './commandLoader.js';

// Exact number of top-level slash commands currently registered. Discord caps a guild at 100;
// this must be bumped intentionally whenever a command is added or removed. Each top-level
// command is a namespace with subcommands (e.g. `/bill view`, `/vote tally`, `/character heal`),
// so adding a new feature should normally add a subcommand under an existing parent rather
// than a new top-level command.
const EXPECTED_COMMAND_COUNT = 18;

describe('toCommandModuleSpecifier', () => {
  it('converts filesystem paths into ESM file URLs for dynamic import', () => {
    const commandPath = join(process.cwd(), 'src', 'commands', 'ping.ts');

    expect(toCommandModuleSpecifier(commandPath)).toBe(pathToFileURL(commandPath).href);
  });
});

describe('loadCommands', () => {
  it('rejects duplicate slash command names', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'hansard-command-loader-'));

    try {
      const commandsDir = join(rootDir, 'commands');
      const nestedDir = join(commandsDir, 'nested');
      mkdirSync(nestedDir, { recursive: true });

      const moduleSource = [
        'export default {',
        '  data: { name: "ping" },',
        '  execute: async () => {}',
        '};',
        '',
      ].join('\n');

      writeFileSync(join(commandsDir, 'ping.ts'), moduleSource);
      writeFileSync(join(nestedDir, 'duplicate.ts'), moduleSource);

      await expect(loadCommands(
        commandsDir,
        new Collection<string, Command>(),
      )).rejects.toThrow('Duplicate command /ping');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps the registered guild slash command set within Discord limits', async () => {
    process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

    const commands = new Collection<string, Command>();
    await loadCommands(join(process.cwd(), 'src', 'commands'), commands);

    // Exact assertion, not a soft `<= 100` bound: Discord caps guild slash commands at 100,
    // and an exact count forces anyone adding a new top-level command to consciously bump
    // this number (and notice how close to the cap we are) rather than silently drifting.
    // If this fails after intentionally adding/removing a command, update the literal.
    expect(commands.size).toBe(EXPECTED_COMMAND_COUNT);
  }, 10_000);
});

describe('collectCommandFiles', () => {
  it('ignores test modules when collecting runtime command files', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'hansard-command-loader-'));

    try {
      const commandsDir = join(rootDir, 'commands');
      mkdirSync(commandsDir);

      const commandFile = join(commandsDir, 'ping.ts');
      const testFile = join(commandsDir, 'ping.test.ts');
      writeFileSync(commandFile, 'export default {};\n');
      writeFileSync(testFile, 'export const notACommand = true;\n');

      expect(collectCommandFiles(rootDir)).toEqual([commandFile]);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
