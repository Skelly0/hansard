import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../types';
import { refreshSessionUser } from './auth';

const mocks = vi.hoisted(() => ({
  aggregatePermissionsForPlayer: vi.fn(),
}));

vi.mock('../services/playerService.js', () => ({
  aggregatePermissionsForPlayer: mocks.aggregatePermissionsForPlayer,
  findOrCreatePlayerByDiscordId: vi.fn(),
}));

function mockDbReturning(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

const sessionUser: SessionUser = {
  id: 'player-1',
  discordId: 'old-discord',
  username: 'old-name',
  avatar: 'avatar.png',
  isStaff: false,
  staffRole: null,
  permissions: [],
};

describe('refreshSessionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregatePermissionsForPlayer.mockResolvedValue(['legislative_leader']);
  });

  it('refreshes identity and permissions from the current player row', async () => {
    const db: any = mockDbReturning([{
      id: 'player-1',
      discordId: 'new-discord',
      discordUsername: 'new-name',
      isStaff: true,
      staffRole: 'admin',
    }]);

    const refreshed = await refreshSessionUser(db, sessionUser);

    expect(refreshed).toEqual({
      id: 'player-1',
      discordId: 'new-discord',
      username: 'new-name',
      avatar: 'avatar.png',
      isStaff: true,
      staffRole: 'admin',
      permissions: ['legislative_leader'],
    });
  });

  it('returns null when the session player no longer exists', async () => {
    const db: any = mockDbReturning([]);

    await expect(refreshSessionUser(db, sessionUser)).resolves.toBeNull();
    expect(mocks.aggregatePermissionsForPlayer).not.toHaveBeenCalled();
  });
});
