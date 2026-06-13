import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  isStaff: vi.fn(),
  postStaffActionLog: vi.fn(),
  refreshPartyJoinMessage: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
}));

vi.mock('@hansard/db', () => ({
  parties: {
    id: 'parties.id',
    name: 'parties.name',
    shortName: 'parties.shortName',
    isActive: 'parties.isActive',
    dissolvedAt: 'parties.dissolvedAt',
    leaderId: 'parties.leaderId',
  },
  players: {
    id: 'players.id',
    partyId: 'players.partyId',
    isActive: 'players.isActive',
  },
  playerEventLog: {},
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

vi.mock('../../utils/partyJoinMessage.js', () => ({
  refreshPartyJoinMessage: mocks.refreshPartyJoinMessage,
}));

import { execute as dissolvePartyExecute } from './dissolve';

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

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class UpdateQuery {
  set(values: Record<string, unknown>) {
    mocks.updateSets.push(values);
    return this;
  }

  where() {
    return Promise.resolve([]);
  }
}

class InsertQuery {
  values(values: Record<string, unknown>) {
    mocks.insertValues.push(values);
    return Promise.resolve([]);
  }
}

function fakeInteraction() {
  return {
    client: { user: { id: 'bot-user' } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    options: {
      getBoolean: vi.fn((name: string) => (name === 'confirm' ? true : null)),
      getString: vi.fn((name: string) => (name === 'party' ? 'Development League' : null)),
    },
  } as any;
}

describe('/party dissolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [];
    mocks.updateSets = [];
    mocks.insertValues = [];
    mocks.isStaff.mockResolvedValue(true);
    mocks.postStaffActionLog.mockResolvedValue(undefined);
    mocks.refreshPartyJoinMessage.mockResolvedValue({ id: 'join-board' });
    mocks.select.mockImplementation(() => new Query(mocks.selectRows.shift() ?? []));
    mocks.update.mockReturnValue(new UpdateQuery());
    mocks.insert.mockReturnValue(new InsertQuery());
  });

  it('refreshes the party join board after dissolving a party', async () => {
    const interaction = fakeInteraction();
    mocks.selectRows = [
      [{ id: 'party-dev', name: 'Development League', shortName: 'DEV' }],
      [],
    ];

    await dissolvePartyExecute(interaction);

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ isActive: false, leaderId: null }));
    expect(mocks.refreshPartyJoinMessage).toHaveBeenCalledWith(interaction.client);
  });
});
