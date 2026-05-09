import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectCommandFiles, toCommandModuleSpecifier } from './commandLoader.js';

describe('toCommandModuleSpecifier', () => {
  it('converts filesystem paths into ESM file URLs for dynamic import', () => {
    const commandPath = join(process.cwd(), 'src', 'commands', 'ping.ts');

    expect(toCommandModuleSpecifier(commandPath)).toBe(pathToFileURL(commandPath).href);
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
