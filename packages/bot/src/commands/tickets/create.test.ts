import { describe, expect, it, vi } from 'vitest';
import command from './create.js';

vi.mock('../../db.js', () => ({ db: {} }));

describe('/ticket command definition', () => {
  it('exposes category management under the existing ticket command', () => {
    const commandJson = command.data.toJSON();
    const subcommandNames = commandJson.options?.map((option) => option.name);

    expect(subcommandNames).toContain('create');
    expect(subcommandNames).toContain('categories');
    expect(subcommandNames).toContain('category-create');
  });
});
