import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  select: vi.fn(),
  update: vi.fn(),
  isStaff: vi.fn(),
  refreshPartyJoinMessage: vi.fn(),
  updateSet: null as Record<string, unknown> | null,
  updatedParty: {
    id: 'party-new',
    name: 'New Horizon',
  },
}));

vi.mock('@hansard/db', () => ({
  parties: {
    id: 'parties.id',
    name: 'parties.name',
  },
  players: {
    id: 'players.id',
    discordId: 'players.discordId',
    characterName: 'players.characterName',
    partyId: 'players.partyId',
    isActive: 'players.isActive',
    isAlive: 'players.isAlive',
  },
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('../../utils/partyJoinMessage.js', () => ({
  refreshPartyJoinMessage: mocks.refreshPartyJoinMessage,
}));

import { execute as editPartyExecute } from './edit';
import partyParentCommand from './party';

class Query<T = unknown> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from() {
    return this;
  }

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class UpdateQuery {
  set(values: Record<string, unknown>) {
    mocks.updateSet = values;
    return this;
  }

  where() {
    return this;
  }

  returning() {
    return Promise.resolve([mocks.updatedParty]);
  }
}

function commandOption(name: string) {
  const editSub = partyParentCommand.data
    .toJSON()
    .options?.find((candidate): candidate is { name: string; options?: unknown[] } & Record<string, unknown> => {
      return (candidate as { name: string }).name === 'edit';
    }) as { options?: Array<{ name: string; type: number }> } | undefined;
  const option = editSub?.options?.find((candidate) => candidate.name === name);
  if (!option) throw new Error(`Missing /party edit ${name} option`);
  return option;
}

function fakeInteraction(overrides: Record<string, unknown> = {}) {
  const strings: Record<string, string | null> = {
    party: 'New Horizon',
    name: null,
    'short-name': null,
    ideology: null,
    colour: null,
  };
  const booleans: Record<string, boolean | null> = {
    'role-clear': null,
    active: null,
    'invite-only': null,
    'leader-clear': null,
  };

  return {
    client: { user: { id: 'bot-user' } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    options: {
      getString: vi.fn((name: string) => strings[name] ?? null),
      getRole: vi.fn(() => null),
      getBoolean: vi.fn((name: string) => booleans[name] ?? null),
      getUser: vi.fn(() => ({ id: 'leader-discord', toString: () => '<@leader-discord>' })),
    },
    ...overrides,
  } as any;
}

describe('/party edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [];
    mocks.updateSet = null;
    mocks.isStaff.mockResolvedValue(true);
    mocks.refreshPartyJoinMessage.mockResolvedValue({ id: 'join-board' });
    mocks.select.mockImplementation(() => new Query(mocks.selectRows.shift() ?? []));
    mocks.update.mockReturnValue(new UpdateQuery());
  });

  it('offers leader and leader-clear options', () => {
    expect(commandOption('leader').type).toBe(6);
    expect(commandOption('leader-clear').type).toBe(5);
  });

  it('lets staff assign a party member as leader', async () => {
    const interaction = fakeInteraction();
    mocks.selectRows = [
      [{ id: 'party-new', name: 'New Horizon', shortName: 'NH' }],
      [{ id: 'leader-player', characterName: 'Avery Chair' }],
    ];

    await editPartyExecute(interaction);

    expect(mocks.updateSet).toMatchObject({ leaderId: 'leader-player' });
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: expect.any(Array) });
  });

  it('rejects assigning a leader who is not an active member of the party', async () => {
    const interaction = fakeInteraction();
    mocks.selectRows = [
      [{ id: 'party-new', name: 'New Horizon', shortName: 'NH' }],
      [],
    ];

    await editPartyExecute(interaction);

    expect(mocks.update).not.toHaveBeenCalled();
    const replyPayload = interaction.editReply.mock.calls[0]?.[0];
    expect(replyPayload.embeds[0].data.description).toContain('active member of New Horizon');
  });

  it('lets staff clear a party leader', async () => {
    const interaction = fakeInteraction({
      options: {
        getString: vi.fn((name: string) => (name === 'party' ? 'New Horizon' : null)),
        getRole: vi.fn(() => null),
        getBoolean: vi.fn((name: string) => (name === 'leader-clear' ? true : null)),
        getUser: vi.fn(() => null),
      },
    });
    mocks.selectRows = [
      [{ id: 'party-new', name: 'New Horizon', shortName: 'NH' }],
    ];

    await editPartyExecute(interaction);

    expect(mocks.updateSet).toMatchObject({ leaderId: null });
  });

  it('refreshes the join board after editing a board-visible field', async () => {
    const interaction = fakeInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'party') return 'New Horizon';
          if (name === 'name') return 'Aurora Accord';
          return null;
        }),
        getRole: vi.fn(() => null),
        getBoolean: vi.fn(() => null),
        getUser: vi.fn(() => null),
      },
    });
    mocks.selectRows = [[{ id: 'party-new', name: 'New Horizon', shortName: 'NH' }]];

    await editPartyExecute(interaction);

    expect(mocks.refreshPartyJoinMessage).toHaveBeenCalledWith(interaction.client);
  });

  it('does not refresh the join board after editing a non-board field', async () => {
    const interaction = fakeInteraction({
      options: {
        getString: vi.fn((name: string) => (name === 'party' ? 'New Horizon' : null)),
        getRole: vi.fn(() => ({ id: 'role-new' })),
        getBoolean: vi.fn(() => null),
        getUser: vi.fn(() => null),
      },
    });
    mocks.selectRows = [[{ id: 'party-new', name: 'New Horizon', shortName: 'NH' }]];

    await editPartyExecute(interaction);

    expect(mocks.refreshPartyJoinMessage).not.toHaveBeenCalled();
  });
});
