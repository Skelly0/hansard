import { describe, expect, it, vi } from 'vitest';
import command from './categoryCreate.js';

vi.mock('../../db.js', () => ({ db: {} }));

describe('/ticket-category-create command definition', () => {
  it('does not hide the command behind Discord Manage Guild permissions', () => {
    const commandJson = command.data.toJSON();

    expect(commandJson.default_member_permissions).toBeUndefined();
  });
});
