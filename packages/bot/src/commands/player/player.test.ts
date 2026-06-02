import { describe, expect, it, vi } from 'vitest';
import command from './player.js';

vi.mock('../../db.js', () => ({
  db: {},
}));

describe('/player command definition', () => {
  it('exposes a staff character lookup subcommand under /player admin', () => {
    const commandJson = command.data.toJSON();
    const adminGroup = commandJson.options?.find((option) => option.name === 'admin');
    expect(adminGroup?.type).toBe(2);

    const adminSubcommands = 'options' in adminGroup! ? adminGroup.options : [];
    const lookup = adminSubcommands?.find((option) => option.name === 'character-lookup');

    expect(lookup).toBeDefined();
    expect('options' in lookup! ? lookup.options?.map((option) => option.name) : []).toContain('name');
  });
});
