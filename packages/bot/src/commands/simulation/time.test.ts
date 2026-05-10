import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './time.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  advanceTime: vi.fn(),
  previewAdvance: vi.fn(),
  postObituaryToGraveyard: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('@hansard/api/services/simulationService', () => ({
  advanceTime: mocks.advanceTime,
  previewAdvance: mocks.previewAdvance,
}));

vi.mock('../../utils/graveyard.js', () => ({
  postObituaryToGraveyard: mocks.postObituaryToGraveyard,
}));

function selectWhereResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe('/time advance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(selectWhereResult([{ id: 'staff-player' }]));
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      fromTick: 1,
      toTick: 2,
      aged: 0,
      ailmentDetails: [],
      pendingDeathDetails: [],
      deathDetails: [{
        playerId: 'dead-player',
        characterName: 'Isabella Grech',
        age: 70,
        cause: 'Many things!',
        ailments: [],
      }],
    });
    mocks.postObituaryToGraveyard.mockResolvedValue({
      status: 'sent',
      channelId: '1499836838192480488',
      obituary: {
        characterName: 'Isabella Grech',
      },
    });
  });

  it('posts automatic death obituaries to the graveyard channel', async () => {
    const interaction = {
      user: { id: 'discord-staff' },
      client: { channels: { fetch: vi.fn() } },
      options: {
        getSubcommand: vi.fn().mockReturnValue('advance'),
        getInteger: vi.fn().mockReturnValue(1),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    expect(mocks.postObituaryToGraveyard).toHaveBeenCalledWith(expect.objectContaining({
      client: interaction.client,
      playerId: 'dead-player',
    }));
  });
});
