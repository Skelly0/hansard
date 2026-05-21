import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAdd } from './ailment.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  isStaff: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
    insert: mocks.insert,
  },
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
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

function updateWhereResult() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function insertValuesResult() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction(send = vi.fn().mockResolvedValue({ id: 'dm-1' })) {
  const targetUser = {
    id: 'discord-target',
    username: 'mira',
    send,
  };

  return {
    targetUser,
    interaction: {
      user: { id: 'discord-staff' },
      guild: { members: { fetch: vi.fn().mockResolvedValue({ id: 'guild-member' }) } },
      member: { id: 'guild-member' },
      options: {
        getUser: vi.fn().mockReturnValue(targetUser),
        getString: vi.fn((name: string) => ({
          condition: 'cancer',
          severity: 'major',
        })[name]),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    },
  };
}

describe('/character ailment-add', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(true);
    mocks.update.mockReturnValue(updateWhereResult());
    mocks.insert.mockReturnValue(insertValuesResult());
    mocks.select
      .mockReturnValueOnce(selectWhereResult([{
        id: 'target-player',
        discordId: 'discord-target',
        discordUsername: 'mira',
        characterName: 'Mira Sol',
        isAlive: true,
        ailments: [],
        currentAge: 48,
      }]))
      .mockReturnValueOnce(selectWhereResult([{ id: 'staff-player' }]))
      .mockReturnValueOnce(selectLimitResult([{
        currentTick: 12,
        currentDate: '2026-02-01',
      }]));
  });

  it('DMs the target player when staff assigns an ailment', async () => {
    const { interaction, targetUser } = makeInteraction();

    await executeAdd(interaction as any);

    expect(targetUser.send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
      allowedMentions: { parse: [] },
    }));
    const dmPayload = targetUser.send.mock.calls[0][0];
    expect(dmPayload.embeds[0].toJSON().description).toContain('cancer');
    expect(dmPayload.embeds[0].toJSON().description).toContain('major');
  });

  it('still confirms staff assignment when the target DM fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction } = makeInteraction(vi.fn().mockRejectedValue(new Error('DMs closed')));

    try {
      await executeAdd(interaction as any);
    } finally {
      warn.mockRestore();
    }

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].toJSON().description).toContain('DM could not be delivered');
  });
});
