import { describe, expect, it, vi } from 'vitest';
import command from './submit.js';
import { SHORT_BILL_TEXT_MAX_LENGTH } from './display.js';

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

  it('lets /bill edit target short bill text', () => {
    const commandJson = command.data.toJSON();
    const edit = commandJson.options?.find((option) => option.name === 'edit');
    const field = edit?.options?.find((option) => option.name === 'field');
    const value = edit?.options?.find((option) => option.name === 'value');

    expect(field?.choices?.map((choice) => choice.value)).toContain('text');
    expect(value?.max_length).toBe(SHORT_BILL_TEXT_MAX_LENGTH);
  });
});
