import { describe, expect, it, vi } from 'vitest';
import command from './withdraw.js';

vi.mock('../../db.js', () => ({ db: {} }));

describe('/bill-withdraw command definition', () => {
  it('accepts a bill reference and optional reason', () => {
    const commandJson = command.data.toJSON();

    expect(commandJson.name).toBe('bill-withdraw');
    expect(commandJson.options?.map((option) => option.name)).toEqual(['bill', 'reason']);
    expect(commandJson.options?.find((option) => option.name === 'bill')?.required).toBe(true);
    expect(commandJson.options?.find((option) => option.name === 'reason')?.required).toBe(false);
  });
});
