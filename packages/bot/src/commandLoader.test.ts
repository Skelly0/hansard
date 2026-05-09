import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Command } from './client.js';
import { collectCommandFiles, loadCommands, toCommandModuleSpecifier } from './commandLoader.js';

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

    expect(commands.size).toBeLessThanOrEqual(100);
  });
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
