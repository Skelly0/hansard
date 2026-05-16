import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './time.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  advanceTime: vi.fn(),
  previewAdvance: vi.fn(),
  postObituaryToGraveyard: vi.fn(),
  postGameEventsEmbed: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

vi.mock('@hansard/api/services/simulationService', () => ({
  advanceTime: mocks.advanceTime,
  previewAdvance: mocks.previewAdvance,
}));

vi.mock('../../utils/graveyard.js', () => ({
  postObituaryToGraveyard: mocks.postObituaryToGraveyard,
}));

vi.mock('../../utils/gameEventsChannel.js', () => ({
  postGameEventsEmbed: mocks.postGameEventsEmbed,
}));

function selectWhereResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function selectLimitResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function updateWhereResult(updateValues: unknown[]) {
  return {
    set: vi.fn((value) => {
      updateValues.push(value);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
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
    mocks.postGameEventsEmbed.mockResolvedValue({
      status: 'sent',
      channelId: '1503483556914266254',
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

  it('posts a public time advance summary to the game events channel', async () => {
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

    expect(mocks.postGameEventsEmbed).toHaveBeenCalledWith(expect.objectContaining({
      client: interaction.client,
      embed: expect.anything(),
    }));
  });

  it('keeps pending death rolls out of the public game events post', async () => {
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      fromTick: 1,
      toTick: 2,
      aged: 0,
      ailmentDetails: [],
      deathDetails: [],
      pendingDeathDetails: [{
        playerId: 'pending-player',
        characterName: 'Cato Vel',
        age: 72,
        cause: 'Critical organ failure',
        ailments: [],
        eligibleFromTick: 3,
        eligibleFromDate: '2026-03-01',
      }],
    });

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

    const publicEmbed = mocks.postGameEventsEmbed.mock.calls[0][0].embed;
    const publicPayload = publicEmbed.toJSON();
    expect(publicPayload.description).not.toContain('Death Rolls Triggered');
    expect(publicPayload.description).not.toContain('Cato Vel');

    const staffReply = (interaction.editReply as any).mock.calls[0][0];
    expect(staffReply.embeds[0].toJSON().description).toContain('Death Rolls Triggered');
  });
});

describe('/time npc-house', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets staff persist whether the NPC house is active', async () => {
    const updateValues: unknown[] = [];
    mocks.select.mockReturnValue(selectLimitResult([{ id: 'clock-1', npcHouseActive: false }]));
    mocks.update.mockReturnValue(updateWhereResult(updateValues));

    const interaction = {
      options: {
        getSubcommand: vi.fn().mockReturnValue('npc-house'),
        getBoolean: vi.fn().mockReturnValue(true),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    expect(updateValues[0]).toMatchObject({
      npcHouseActive: true,
    });
    expect(updateValues[0]).toHaveProperty('updatedAt');
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
