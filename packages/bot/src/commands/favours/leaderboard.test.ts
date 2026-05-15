import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  db: {},
}));

import favourCommand from './favour.js';

describe('/favour leaderboard', () => {
  it('is registered as a subcommand under /favour with staff-only description', () => {
    const json = favourCommand.data.toJSON();

    const leaderboardSub = (json.options ?? []).find(
      (opt: any) => opt.name === 'leaderboard',
    ) as { description?: string } | undefined;

    expect(leaderboardSub).toBeDefined();
    expect(leaderboardSub?.description).toContain('staff only');
  });
});
