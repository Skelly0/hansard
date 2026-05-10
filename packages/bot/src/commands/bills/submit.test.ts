import { describe, expect, it, vi } from 'vitest';
import command from './submit.js';

vi.mock('../../db.js', () => ({ db: {} }));

describe('/bill command definition', () => {
  it('uses a single submit flow that asks for bill type after launch', () => {
    const commandJson = command.data.toJSON();
    const subcommandNames = commandJson.options?.map((option) => option.name);
    const submit = commandJson.options?.find((option) => option.name === 'submit');

    expect(subcommandNames).toContain('submit');
    expect(subcommandNames).not.toContain('submit-short');
    expect(submit?.options?.map((option) => option.name)).toEqual(['title']);
  });
});
