import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isStaff: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {},
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

import favourCommand from './favour.js';
import { execute } from './leaderboard.js';

describe('/favour leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is registered as a subcommand under /favour with staff-only description', () => {
    const json = favourCommand.data.toJSON();

    const leaderboardSub = (json.options ?? []).find(
      (opt: any) => opt.name === 'leaderboard',
    ) as { description?: string } | undefined;

    expect(leaderboardSub).toBeDefined();
    expect(leaderboardSub?.description).toContain('staff only');
  });

  it('rejects non-staff callers at runtime', async () => {
    mocks.isStaff.mockResolvedValue(false);

    const editReply = vi.fn();
    const interaction = {
      member: { roles: { cache: new Map() } },
      deferReply: vi.fn(),
      editReply,
      options: { getString: () => null },
    };

    await execute(interaction as any);

    expect(mocks.isStaff).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledTimes(1);
    const embed = editReply.mock.calls[0]?.[0]?.embeds?.[0];
    const description = embed?.data?.description ?? embed?.description;
    expect(description).toMatch(/staff/i);
  });
});
