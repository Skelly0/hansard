import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  db: {},
}));

import leaderboardCommand from './leaderboard.js';

describe('/favour-leaderboard', () => {
  it('is restricted to staff-capable members by default', () => {
    const json = leaderboardCommand.data.toJSON();

    expect(json.description).toContain('staff only');
    expect(json.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
  });
});
