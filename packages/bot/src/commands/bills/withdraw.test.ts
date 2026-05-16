import { describe, expect, it, vi } from 'vitest';
import command from './submit.js';

vi.mock('../../db.js', () => ({ db: {} }));

describe('/bill withdraw subcommand definition', () => {
  it('accepts a bill reference and optional reason', () => {
    const commandJson = command.data.toJSON();
    const withdraw = commandJson.options?.find((option) => option.name === 'withdraw');

    expect(withdraw).toBeDefined();
    expect(withdraw && 'options' in withdraw ? withdraw.options?.map((option) => option.name) : []).toEqual(['bill', 'reason']);
    expect(withdraw && 'options' in withdraw ? withdraw.options?.find((option) => option.name === 'bill')?.required : undefined).toBe(true);
    expect(withdraw && 'options' in withdraw ? withdraw.options?.find((option) => option.name === 'reason')?.required : undefined).toBe(false);
  });
});
