import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './grantBulk.js';

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const txSelectResults: unknown[][] = [];
  const whereArgs: unknown[] = [];

  function makeWhereResult() {
    const nextRows = () => Promise.resolve(selectResults.shift() ?? []);
    return {
      limit: vi.fn(nextRows),
      orderBy: vi.fn(nextRows),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>
        nextRows().then(resolve, reject),
    };
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const where = vi.fn((whereArg: unknown) => {
          whereArgs.push(whereArg);
          return makeWhereResult();
        });
        return {
          where,
          innerJoin: vi.fn(() => ({ where })),
        };
      }),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  };

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(txSelectResults.shift() ?? [])),
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
    txSelectResults,
    whereArgs,
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

function makeInteraction(usersById: Record<string, { send: ReturnType<typeof vi.fn> }>) {
  const fetch = vi.fn((id: string) => Promise.resolve(usersById[id]));

  return {
    interaction: {
      user: {
        id: 'discord-staff',
        toString: () => '<@discord-staff>',
      },
      member: { id: 'guild-member', roles: {} },
      client: {
        users: { fetch },
      },
      options: {
        getString: vi.fn((name: string) => ({
          category: 'Crown',
          party: name === 'party' ? 'Unity' : null,
          office: null,
          reason: 'session attendance',
        })[name] ?? null),
        getInteger: vi.fn().mockReturnValue(2),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    },
    fetch,
  };
}

function containsText(value: unknown, pattern: RegExp, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return pattern.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (containsText(child, pattern, seen)) return true;
  }

  return false;
}

describe('/favour grant-bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.txSelectResults.length = 0;
    mocks.whereArgs.length = 0;
    mocks.isStaff.mockResolvedValue(true);
    mocks.selectResults.push(
      [{ id: 'staff-player' }],
      [{
        id: 'category-1',
        name: 'Crown',
        emoji: 'C',
        isActive: true,
        sortOrder: 1,
      }],
      [{ id: 'party-1', name: 'Unity' }],
      [
        {
          id: 'target-a',
          discordId: 'discord-a',
          discordUsername: 'mira',
          characterName: 'Mira Sol',
        },
        {
          id: 'target-b',
          discordId: 'discord-b',
          discordUsername: 'lyra',
          characterName: 'Lyra Vox',
        },
      ],
    );
    mocks.txSelectResults.push(
      [{ id: 'balance-a', playerId: 'target-a', categoryId: 'category-1', balance: 3 }],
      [{ id: 'balance-b', playerId: 'target-b', categoryId: 'category-1', balance: 10 }],
    );
  });

  it('DMs each recipient after a successful bulk grant', async () => {
    const sendA = vi.fn().mockResolvedValue({ id: 'dm-a' });
    const sendB = vi.fn().mockResolvedValue({ id: 'dm-b' });
    const { interaction, fetch } = makeInteraction({
      'discord-a': { send: sendA },
      'discord-b': { send: sendB },
    });

    await execute(interaction as any);

    expect(fetch).toHaveBeenCalledWith('discord-a');
    expect(fetch).toHaveBeenCalledWith('discord-b');
    expect(sendA).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
      allowedMentions: { parse: [] },
    }));
    const dmPayload = sendA.mock.calls[0][0];
    const dmJson = dmPayload.embeds[0].toJSON();
    expect(dmJson.description).toContain('+2');
    expect(dmJson.description).toContain('Crown');
    expect(dmJson.description).toContain('New balance: `5`');
  });

  it('reports partial bulk DM failures without failing the grant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sendA = vi.fn().mockResolvedValue({ id: 'dm-a' });
    const sendB = vi.fn().mockRejectedValue(new Error('DMs closed'));
    const { interaction } = makeInteraction({
      'discord-a': { send: sendA },
      'discord-b': { send: sendB },
    });

    try {
      await execute(interaction as any);
    } finally {
      warn.mockRestore();
    }

    const reply = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(reply.embeds[0].toJSON().description).toContain('Favour DMs: 1/2 sent');
    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
  });

  it('starts bulk recipient DMs without serially waiting for each one to finish', async () => {
    let resolveFirstSend!: () => void;
    const firstSendStarted = new Promise<void>((resolve) => {
      resolveFirstSend = resolve;
    });
    const sendA = vi.fn(() => firstSendStarted.then(() => ({ id: 'dm-a' })));
    const sendB = vi.fn().mockResolvedValue({ id: 'dm-b' });
    const { interaction } = makeInteraction({
      'discord-a': { send: sendA },
      'discord-b': { send: sendB },
    });

    const executePromise = execute(interaction as any);
    await vi.waitFor(() => expect(sendA).toHaveBeenCalledTimes(1));

    expect(sendB).toHaveBeenCalledTimes(1);

    resolveFirstSend();
    await executePromise;
  });

  it('filters office bulk recipients to living players', async () => {
    const { interaction } = makeInteraction({
      'discord-a': { send: vi.fn().mockResolvedValue({ id: 'dm-a' }) },
    });
    interaction.options.getString = vi.fn((name: string) => ({
      category: 'Crown',
      party: null,
      office: name === 'office' ? 'Chancellor' : null,
      reason: 'office work',
    })[name] ?? null);
    mocks.selectResults.length = 0;
    mocks.selectResults.push(
      [{ id: 'staff-player' }],
      [{ id: 'category-1', name: 'Crown', emoji: 'C', isActive: true, sortOrder: 1 }],
      [{ id: 'office-1', name: 'Chancellor' }],
      [{
        id: 'target-a',
        discordId: 'discord-a',
        discordUsername: 'mira',
        characterName: 'Mira Sol',
      }],
    );
    mocks.txSelectResults.push([
      { id: 'balance-a', playerId: 'target-a', categoryId: 'category-1', balance: 3 },
    ]);

    await execute(interaction as any);

    expect(mocks.whereArgs.some((arg) => containsText(arg, /is_alive/i))).toBe(true);
  });
});
