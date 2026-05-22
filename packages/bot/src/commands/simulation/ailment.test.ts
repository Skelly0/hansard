import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAdd } from './ailment.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  isStaff: vi.fn(),
  postStaffActionLog: vi.fn(),
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

vi.mock('../../utils/modLog.js', () => ({
  postStaffActionLog: mocks.postStaffActionLog,
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
        getInteger: vi.fn().mockReturnValue(null),
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

  it('stores an optional staff-provided recovery lifetime', async () => {
    const { interaction } = makeInteraction();
    interaction.options.getString.mockImplementation((name: string) => ({
      condition: 'Head Trauma',
      severity: 'major',
    })[name]);
    interaction.options.getInteger.mockImplementation((name: string) =>
      name === 'duration-years' ? 5 : null,
    );

    await executeAdd(interaction as any);

    const updateSet = mocks.update.mock.results[0]!.value.set;
    expect(updateSet.mock.calls[0][0].ailments[0]).toMatchObject({
      condition: 'Head Trauma',
      severity: 'major',
      durationYears: 5,
      healsAtDate: '2031-02-01',
    });

    const insertValues = mocks.insert.mock.results[0]!.value.values;
    expect(insertValues.mock.calls[0][0].newValue).toMatchObject({
      condition: 'Head Trauma',
      durationYears: 5,
      healsAtDate: '2031-02-01',
    });

    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].toJSON().description).toContain('Expected recovery: 2031-02-01');
  });

  it('posts a staff action log when staff assigns an ailment', async () => {
    const { interaction } = makeInteraction();

    await executeAdd(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        title: 'Ailment Assigned',
        system: 'simulation',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'Player', value: '**Mira Sol** (<@discord-target>)' }),
          expect.objectContaining({ name: 'Condition', value: 'cancer' }),
          expect.objectContaining({ name: 'Severity', value: 'major' }),
        ]),
      }),
    );
  });
});
