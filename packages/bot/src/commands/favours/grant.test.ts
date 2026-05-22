import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './grant.js';

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
          orderBy: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
        })),
      })),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  };

  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ balance: 7 }])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve(undefined)),
    })),
  };

  return {
    db,
    isStaff: vi.fn(),
    postStaffActionLog: vi.fn(),
    selectResults,
    tx,
  };
});

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('../../utils/modLog.js', () => ({
  postStaffActionLog: mocks.postStaffActionLog,
}));

function makeInteraction() {
  const targetUser = {
    id: 'discord-target',
    username: 'mira',
    toString: () => '<@discord-target>',
  };

  return {
    targetUser,
    interaction: {
      user: {
        id: 'discord-staff',
        toString: () => '<@discord-staff>',
      },
      member: { id: 'guild-member', roles: {} },
      options: {
        getUser: vi.fn().mockReturnValue(targetUser),
        getString: vi.fn((name: string) => ({
          category: 'Crown',
          reason: 'excellent diplomacy',
        })[name] ?? null),
        getInteger: vi.fn().mockReturnValue(3),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    },
  };
}

describe('/favour grant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.isStaff.mockResolvedValue(true);
    mocks.selectResults.push(
      [{ id: 'staff-player' }],
      [{
        id: 'target-player',
        discordId: 'discord-target',
        discordUsername: 'mira',
        characterName: 'Mira Sol',
      }],
      [{
        id: 'category-1',
        name: 'Crown',
        emoji: 'C',
        isActive: true,
        sortOrder: 1,
      }],
    );
  });

  it('posts a staff action log when staff grants favours', async () => {
    const { interaction } = makeInteraction();

    await execute(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        title: 'Favours Granted',
        system: 'favours',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'Player', value: '**Mira Sol** (<@discord-target>)' }),
          expect.objectContaining({ name: 'Category', value: 'Crown' }),
          expect.objectContaining({ name: 'Amount', value: '+3' }),
          expect.objectContaining({ name: 'Reason', value: 'excellent diplomacy' }),
        ]),
      }),
    );
  });

  it('posts the staff action log before replying so reply failures do not hide committed grants', async () => {
    const { interaction } = makeInteraction();
    interaction.editReply.mockRejectedValueOnce(new Error('Discord reply failed'));

    await execute(interaction as any);

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
  });
});
