import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './kill';
import { db } from '../../db';
import { manualDeath } from '@hansard/api/services/simulationService';
import { postObituaryToGraveyard } from '../../utils/graveyard';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  manualDeath: vi.fn(),
  postObituaryToGraveyard: vi.fn(),
  isStaff: vi.fn(),
  postStaffActionLog: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('@hansard/api/services/simulationService', () => ({
  manualDeath: mocks.manualDeath,
}));

vi.mock('../../utils/graveyard.js', () => ({
  postObituaryToGraveyard: mocks.postObituaryToGraveyard,
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('../../utils/modLog.js', () => ({
  postStaffActionLog: mocks.postStaffActionLog,
}));

function selectWhereRows(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe('/character kill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff.mockResolvedValue(true);
    mocks.postObituaryToGraveyard.mockResolvedValue({
      status: 'disabled',
      channelId: null,
      obituary: {
        characterName: 'Ada Mortalis',
        age: 76,
        ailments: [],
      },
    });
  });

  it('uses the shared manualDeath service so favour expiry stays consistent', async () => {
    const targetPlayer = {
      id: 'player-1',
      discordId: 'target-discord',
      characterName: 'Ada Mortalis',
      currentAge: 76,
      ailments: [],
      isAlive: true,
    };
    const staffPlayer = { id: 'staff-1', discordId: 'staff-discord' };

    mocks.select
      .mockReturnValueOnce(selectWhereRows([targetPlayer]))
      .mockReturnValueOnce(selectWhereRows([staffPlayer]));
    mocks.manualDeath.mockResolvedValue({
      player: targetPlayer,
      cause: 'natural causes',
      deathDate: '2026-03-01',
      ailments: [],
    });

    const interaction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({ roles: {} }),
        },
      },
      member: { roles: {} },
      user: { id: 'staff-discord' },
      client: {},
      options: {
        getUser: vi.fn().mockReturnValue({ id: 'target-discord', username: 'target' }),
        getString: vi.fn().mockReturnValue('natural causes'),
      },
    };

    await execute(interaction as any);

    expect(manualDeath).toHaveBeenCalledWith(db, 'player-1', 'natural causes', 'staff-1');
    expect(postObituaryToGraveyard).toHaveBeenCalledWith(expect.objectContaining({
      db,
      playerId: 'player-1',
    }));
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
