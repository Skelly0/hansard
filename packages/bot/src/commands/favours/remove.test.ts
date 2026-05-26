import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './remove.js';

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
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
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

function makeInteraction(send = vi.fn().mockResolvedValue({ id: 'dm-1' })) {
  const targetUser = {
    id: 'discord-target',
    username: 'mira',
    send,
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
          reason: 'audit correction',
        })[name]),
        getInteger: vi.fn().mockReturnValue(2),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    },
  };
}

describe('/favour remove', () => {
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
      [{
        id: 'balance-1',
        playerId: 'target-player',
        categoryId: 'category-1',
        balance: 7,
      }],
    );
  });

  it('DMs the target player when staff removes favours', async () => {
    const { interaction, targetUser } = makeInteraction();

    await execute(interaction as any);

    expect(targetUser.send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
      allowedMentions: { parse: [] },
    }));
    const dmPayload = targetUser.send.mock.calls[0][0];
    const dmJson = dmPayload.embeds[0].toJSON();
    expect(dmJson.description).toContain('-2');
    expect(dmJson.description).toContain('Crown');
    expect(dmJson.description).toContain('New balance: `5`');
    expect(dmJson.description).toContain('audit correction');
  });

  it('still confirms the removal when the target DM fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction } = makeInteraction(vi.fn().mockRejectedValue(new Error('DMs closed')));

    try {
      await execute(interaction as any);
    } finally {
      warn.mockRestore();
    }

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
    const reply = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(reply.embeds[0].toJSON().description).toContain('DM could not be delivered');
    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
  });
});
