import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './time.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  advanceTime: vi.fn(),
  previewAdvance: vi.fn(),
  postObituaryToGraveyard: vi.fn(),
  postGameEventsEmbed: vi.fn(),
  isStaff: vi.fn(),
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

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

const staffGuild = {
  members: { fetch: vi.fn().mockResolvedValue({ id: 'staff-member' }) },
};

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
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(true);
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
      channelId: '123456789012345678',
      obituary: {
        characterName: 'Isabella Grech',
      },
    });
    mocks.postGameEventsEmbed.mockResolvedValue({
      status: 'sent',
      channelId: '123456789012345678',
    });
  });

  it('posts automatic death obituaries to the graveyard channel', async () => {
    const interaction = {
      user: { id: 'discord-staff' },
      guild: staffGuild,
      member: { id: 'staff-member' },
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
      guild: staffGuild,
      member: { id: 'staff-member' },
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

  it('hides ailment details from the public game events post', async () => {
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      fromTick: 1,
      toTick: 2,
      aged: 1,
      ailmentDetails: [{
        playerId: 'ailing-player',
        characterName: 'Mira Sol',
        condition: 'cancer',
        severity: 'major',
      }],
      deathDetails: [{
        playerId: 'dead-player',
        characterName: 'Isabella Grech',
        age: 70,
        cause: 'stroke',
        ailments: [{ condition: 'stroke', severity: 'critical' }],
      }],
      pendingDeathDetails: [],
    });

    const interaction = {
      user: { id: 'discord-staff' },
      guild: staffGuild,
      member: { id: 'staff-member' },
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
    const publicDescription = publicEmbed.toJSON().description;
    expect(publicDescription).not.toContain('New Ailments');
    expect(publicDescription).not.toContain('Mira Sol');
    expect(publicDescription).not.toContain('cancer');
    expect(publicDescription).not.toContain('stroke');
    expect(publicDescription).not.toContain('ailments:');

    const staffReply = (interaction.editReply as any).mock.calls[0][0];
    const staffDescription = staffReply.embeds[0].toJSON().description;
    expect(staffDescription).toContain('New Ailments');
    expect(staffDescription).toContain('Mira Sol');
    expect(staffDescription).toContain('cancer (major)');
    expect(staffDescription).toContain('stroke (critical)');
  });

  it('DMs players who acquire ailments during time advance', async () => {
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      fromTick: 1,
      toTick: 2,
      aged: 1,
      ailmentDetails: [{
        playerId: 'ailing-player',
        characterName: 'Mira Sol',
        condition: 'cancer',
        severity: 'major',
      }],
      deathDetails: [],
      pendingDeathDetails: [],
    });
    mocks.select
      .mockReturnValueOnce(selectWhereResult([{ id: 'staff-player' }]))
      .mockReturnValueOnce(selectWhereResult([{
        id: 'ailing-player',
        discordId: 'discord-ailing',
        characterName: 'Mira Sol',
      }]));

    const send = vi.fn().mockResolvedValue({ id: 'dm-1' });
    const interaction = {
      user: { id: 'discord-staff' },
      guild: staffGuild,
      member: { id: 'staff-member' },
      client: {
        users: { fetch: vi.fn().mockResolvedValue({ send }) },
        channels: { fetch: vi.fn() },
      },
      options: {
        getSubcommand: vi.fn().mockReturnValue('advance'),
        getInteger: vi.fn().mockReturnValue(1),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    expect(interaction.client.users.fetch).toHaveBeenCalledWith('discord-ailing');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
      allowedMentions: { parse: [] },
    }));
    const dmPayload = send.mock.calls[0][0];
    expect(dmPayload.embeds[0].toJSON().description).toContain('cancer');
    expect(dmPayload.embeds[0].toJSON().description).toContain('major');
  });

  it('keeps time advance successful when an ailment DM cannot be delivered', async () => {
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      fromTick: 1,
      toTick: 2,
      aged: 1,
      ailmentDetails: [{
        playerId: 'ailing-player',
        characterName: 'Mira Sol',
        condition: 'cancer',
        severity: 'major',
      }],
      deathDetails: [],
      pendingDeathDetails: [],
    });
    mocks.select
      .mockReturnValueOnce(selectWhereResult([{ id: 'staff-player' }]))
      .mockReturnValueOnce(selectWhereResult([{
        id: 'ailing-player',
        discordId: 'discord-ailing',
        characterName: 'Mira Sol',
      }]));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const interaction = {
      user: { id: 'discord-staff' },
      guild: staffGuild,
      member: { id: 'staff-member' },
      client: {
        users: {
          fetch: vi.fn().mockResolvedValue({
            send: vi.fn().mockRejectedValue(new Error('DMs closed')),
          }),
        },
        channels: { fetch: vi.fn() },
      },
      options: {
        getSubcommand: vi.fn().mockReturnValue('advance'),
        getInteger: vi.fn().mockReturnValue(1),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    try {
      await command.execute(interaction as any);
    } finally {
      warn.mockRestore();
    }

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
    const staffReply = (interaction.editReply as any).mock.calls[0][0];
    expect(staffReply.embeds[0].toJSON().description).toContain('Ailment DMs: 0/1 sent');
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
      guild: staffGuild,
      member: { id: 'staff-member' },
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
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(true);
  });

  it('lets staff persist whether the NPC house is active', async () => {
    const updateValues: unknown[] = [];
    mocks.select.mockReturnValue(selectLimitResult([{ id: 'clock-1', npcHouseActive: false }]));
    mocks.update.mockReturnValue(updateWhereResult(updateValues));

    const interaction = {
      user: { id: 'discord-staff' },
      guild: staffGuild,
      member: { id: 'staff-member' },
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

describe('/time staff gate', () => {
  function selectAnyResult(rows: unknown[]) {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockResolvedValue(rows),
      }),
    };
  }

  function playerInteraction(sub: string) {
    return {
      user: { id: 'discord-player' },
      guild: { members: { fetch: vi.fn().mockResolvedValue({ id: 'player-member' }) } },
      member: { id: 'player-member' },
      client: { channels: { fetch: vi.fn() } },
      options: {
        getSubcommand: vi.fn().mockReturnValue(sub),
        getInteger: vi.fn().mockReturnValue(1),
        getBoolean: vi.fn().mockReturnValue(true),
        getString: vi.fn().mockReturnValue('2075-01-01'),
      },
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
  }

  function repliedText(interaction: ReturnType<typeof playerInteraction>): string {
    return JSON.stringify([...interaction.reply.mock.calls, ...interaction.editReply.mock.calls]);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(false);
    mocks.select.mockReturnValue(selectAnyResult([{ id: 'player-row', npcHouseActive: false, isPaused: false }]));
    mocks.update.mockReturnValue(updateWhereResult([]));
    mocks.advanceTime.mockResolvedValue({
      fromDate: '2026-01-01', toDate: '2026-02-01', fromTick: 1, toTick: 2,
      aged: 0, ailmentDetails: [], pendingDeathDetails: [], deathDetails: [],
    });
    mocks.previewAdvance.mockResolvedValue({
      fromDate: '2026-01-01', toDate: '2026-02-01', fromTick: 1, toTick: 2,
      wouldAge: 0, ailmentDetails: [], pendingDeathDetails: [], deathDetails: [],
    });
  });

  it('refuses /time advance for members who are not staff', async () => {
    const interaction = playerInteraction('advance');

    await command.execute(interaction as any);

    expect(mocks.advanceTime).not.toHaveBeenCalled();
    expect(repliedText(interaction)).toMatch(/permission/i);
  });

  it.each(['set', 'pause', 'unpause', 'npc-house'])(
    'refuses /time %s for members who are not staff',
    async (sub) => {
      const interaction = playerInteraction(sub);

      await command.execute(interaction as any);

      expect(mocks.update).not.toHaveBeenCalled();
      expect(repliedText(interaction)).toMatch(/permission/i);
    },
  );

  it('refuses /time preview for members who are not staff', async () => {
    const interaction = playerInteraction('preview');

    await command.execute(interaction as any);

    expect(mocks.previewAdvance).not.toHaveBeenCalled();
    expect(repliedText(interaction)).toMatch(/permission/i);
  });

  it('still lets non-staff members read /time status', async () => {
    mocks.select.mockReturnValue(selectAnyResult([{
      currentDate: '2075-01-01', currentTick: 1, tickUnit: 'month',
      seasonName: 'Season 1', isPaused: false, startDate: '2075-01-01',
    }]));
    const interaction = playerInteraction('status');

    await command.execute(interaction as any);

    expect(repliedText(interaction)).not.toMatch(/permission/i);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
