import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autocomplete, execute } from './elect.js';

const mocks = vi.hoisted(() => ({
  autocompleteOffice: vi.fn(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    insert: vi.fn(),
  },
  hasPermission: vi.fn(),
  seedAllReactionsForOpenVote: vi.fn(),
  wakeVoteAutoCloseWorker: vi.fn(),
  selectRows: [] as unknown[][],
  insertedElection: null as any,
  insertedCandidates: null as any,
  updateSet: null as any,
  updateSets: [] as any[],
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  inArray: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('../office/_officeAutocomplete.js', () => ({
  autocompleteOffice: mocks.autocompleteOffice,
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('../../services/voteAutoClose.js', () => ({
  wakeVoteAutoCloseWorker: mocks.wakeVoteAutoCloseWorker,
}));

vi.mock('./_seedFptpReactions.js', () => ({
  seedAllReactionsForOpenVote: mocks.seedAllReactionsForOpenVote,
}));

vi.mock('@hansard/db', () => ({
  candidates: {
    id: 'candidates.id',
  },
  elections: {
    id: 'elections.id',
  },
  offices: {
    id: 'offices.id',
    name: 'offices.name',
    isActive: 'offices.isActive',
  },
  players: {
    id: 'players.id',
    discordId: 'players.discordId',
    discordUsername: 'players.discordUsername',
    characterName: 'players.characterName',
    partyId: 'players.partyId',
    isAlive: 'players.isAlive',
  },
}));

class Query<T = unknown> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from() {
    return this;
  }

  where() {
    return this;
  }

  limit() {
    return Promise.resolve(this.rows);
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

const officeRow = { id: 'office-1', name: 'Archon' };
const creatorRow = { id: 'creator-player' };
const candidateUser = { id: 'candidate-discord', username: 'candidate' };
const candidateUser2 = { id: 'candidate-discord-2', username: 'candidate-two' };
const candidatePlayer = {
  id: 'candidate-player',
  discordId: 'candidate-discord',
  discordUsername: 'candidate',
  characterName: 'Ada Archon',
  partyId: 'party-1',
  isAlive: true,
};
const candidatePlayer2 = {
  id: 'candidate-player-2',
  discordId: 'candidate-discord-2',
  discordUsername: 'candidate-two',
  characterName: 'Bea Ballot',
  partyId: null,
  isAlive: true,
};

function makeInteraction(options: {
  strings?: Record<string, string | null>;
  numbers?: Record<string, number | null>;
  booleans?: Record<string, boolean | null>;
  users?: Record<string, any>;
} = {}) {
  const strings = {
    office: 'Archon',
    method: 'fptp',
    ...options.strings,
  };

  return {
    member: { roles: {} },
    user: { id: 'chancellor-discord' },
    client: {},
    options: {
      getString: vi.fn((name: string) => strings[name] ?? null),
      getNumber: vi.fn((name: string) => options.numbers?.[name] ?? null),
      getBoolean: vi.fn((name: string) => options.booleans?.[name] ?? null),
      getUser: vi.fn((name: string) => options.users?.[name] ?? null),
    },
    reply: vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1' }),
    followUp: vi.fn(),
  };
}

describe('/vote elect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.selectRows = [[officeRow], [creatorRow]];
    mocks.insertedElection = null;
    mocks.insertedCandidates = null;
    mocks.updateSet = null;
    mocks.updateSets = [];
    mocks.hasPermission.mockResolvedValue(true);
    mocks.autocompleteOffice.mockResolvedValue(undefined);
    mocks.seedAllReactionsForOpenVote.mockResolvedValue({
      totalCandidates: 1,
      seededCount: 1,
      overflow: false,
    });
    mocks.db.select.mockImplementation(() => new Query(mocks.selectRows.shift() ?? []));
    const insertImpl = () => ({
      values: vi.fn((values) => {
        if (Array.isArray(values)) {
          mocks.insertedCandidates = values;
          return Promise.resolve([]);
        }

        mocks.insertedElection = values;
        return {
          returning: vi.fn().mockResolvedValue([{ id: 'election-1' }]),
        };
      }),
    });
    mocks.db.insert.mockImplementation(insertImpl);
    mocks.tx.insert.mockImplementation(insertImpl);
    mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.db.update.mockReturnValue({
      set: vi.fn((set) => {
        mocks.updateSet = set;
        mocks.updateSets.push(set);
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    });
  });

  it('keeps nominations open with custom timings when no direct candidates are supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const interaction = makeInteraction({
      numbers: {
        'nominations-hours': 12,
        'duration-hours': 36,
      },
    });

    await execute(interaction as any);

    expect(mocks.insertedElection.status).toBe('nominations_open');
    expect(mocks.insertedElection.useReactions).toBe(true);
    expect(mocks.insertedElection.nominationsCloseAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(mocks.insertedElection.votingOpensAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(mocks.insertedElection.votingClosesAt.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(mocks.insertedCandidates).toBeNull();
    expect(mocks.updateSet).toEqual(expect.objectContaining({
      discordMessageId: 'message-1',
      discordChannelId: 'channel-1',
    }));
    expect(mocks.wakeVoteAutoCloseWorker).not.toHaveBeenCalled();
  });

  it('opens voting immediately with supplied candidates and button interface', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mocks.selectRows = [[officeRow], [candidatePlayer], [creatorRow]];
    const interaction = makeInteraction({
      strings: { interface: 'buttons' },
      numbers: { 'duration-hours': 12 },
      users: { 'candidate-1': candidateUser },
    });

    await execute(interaction as any);

    expect(mocks.insertedElection.status).toBe('voting_open');
    expect(mocks.insertedElection.useReactions).toBe(false);
    expect(mocks.insertedElection.nominationsCloseAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(mocks.insertedElection.votingOpensAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(mocks.insertedElection.votingClosesAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.insertedCandidates).toEqual([expect.objectContaining({
      electionId: 'election-1',
      playerId: 'candidate-player',
      partyId: 'party-1',
      nominatedById: 'creator-player',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    })]);
    expect(mocks.wakeVoteAutoCloseWorker).toHaveBeenCalledWith('position-election-opened');
    expect(mocks.seedAllReactionsForOpenVote).not.toHaveBeenCalled();
  });

  it('preserves direct candidate slot order with explicit registration timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mocks.selectRows = [[officeRow], [candidatePlayer2, candidatePlayer], [creatorRow]];
    const interaction = makeInteraction({
      strings: { interface: 'buttons' },
      users: {
        'candidate-1': candidateUser,
        'candidate-2': candidateUser2,
      },
    });

    await execute(interaction as any);

    expect(mocks.insertedCandidates).toEqual([
      expect.objectContaining({
        playerId: 'candidate-player',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      expect.objectContaining({
        playerId: 'candidate-player-2',
        registeredAt: new Date('2026-01-01T00:00:00.001Z'),
      }),
    ]);
  });

  it('requires at least one candidate when explicitly skipping nominations', async () => {
    const interaction = makeInteraction({
      booleans: { 'skip-nominations': true },
    });

    await execute(interaction as any);

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
    }));
  });

  it('seeds reaction emoji when direct FPTP candidates open immediately in reaction mode', async () => {
    mocks.selectRows = [[officeRow], [candidatePlayer], [creatorRow]];
    const interaction = makeInteraction({
      strings: { interface: 'reactions' },
      users: { 'candidate-1': candidateUser },
    });

    await execute(interaction as any);

    expect(mocks.updateSet).toEqual(expect.objectContaining({
      discordMessageId: 'message-1',
      discordChannelId: 'channel-1',
    }));
    expect(mocks.seedAllReactionsForOpenVote).toHaveBeenCalledWith({
      client: interaction.client,
      electionId: 'election-1',
      channelId: 'channel-1',
      messageId: 'message-1',
    });
  });

  it('cancels a reaction election if its public message cannot be linked', async () => {
    mocks.selectRows = [[officeRow], [candidatePlayer], [creatorRow]];
    mocks.db.update
      .mockReturnValueOnce({
        set: vi.fn((set) => {
          mocks.updateSets.push(set);
          return {
            where: vi.fn().mockRejectedValue(new Error('link failed')),
          };
        }),
      })
      .mockReturnValueOnce({
        set: vi.fn((set) => {
          mocks.updateSets.push(set);
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      });
    const interaction = makeInteraction({
      strings: { interface: 'reactions' },
      users: { 'candidate-1': candidateUser },
    });

    await execute(interaction as any);

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ status: 'cancelled' }));
    expect(mocks.seedAllReactionsForOpenVote).not.toHaveBeenCalled();
    expect(mocks.wakeVoteAutoCloseWorker).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
    }));
  });
});

describe('/vote elect autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autocompleteOffice.mockResolvedValue(undefined);
  });

  it('uses the shared office autocomplete source', async () => {
    const interaction = {
      options: {
        getFocused: vi.fn(() => ({ name: 'office', value: 'arch' })),
      },
      respond: vi.fn(),
    };

    await autocomplete(interaction as any);

    expect(mocks.autocompleteOffice).toHaveBeenCalledWith(interaction);
    expect(interaction.respond).not.toHaveBeenCalled();
  });
});
