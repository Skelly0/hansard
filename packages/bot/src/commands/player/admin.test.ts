import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeChangeParty } from './admin.js';

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  selectRows: [] as unknown[][],
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  isStaff: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
}));

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

function fakeChangePartyInteraction() {
  const targetMember = {
    roles: {
      remove: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    user: { id: 'staff-discord', toString: () => '<@staff-discord>' },
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue(targetMember),
      },
    },
    options: {
      getUser: vi.fn(() => ({
        id: 'target-discord',
        username: 'TargetUser',
        toString: () => '<@target-discord>',
      })),
      getString: vi.fn(() => 'Reform Party'),
    },
    targetMember,
  } as any;
}

describe('/player admin change-party', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.selectRows = [];
    mocks.updateSets = [];
    mocks.insertValues = [];
    mocks.isStaff.mockResolvedValue(true);
    mocks.select.mockImplementation(() => new Query(mocks.selectRows.shift() ?? mocks.rows));
    mocks.update.mockReturnValue(new UpdateQuery());
    mocks.insert.mockReturnValue(new InsertQuery());
  });

  it('clears the old party leader and syncs Discord roles when staff moves a leader to another party', async () => {
    const interaction = fakeChangePartyInteraction();
    mocks.selectRows = [
      // target player lookup
      [{
        id: 'target-player',
        discordId: 'target-discord',
        characterName: 'Aldrick Vance',
        partyId: 'party-old',
      }],
      // staff player lookup
      [{ id: 'staff-player' }],
      // old party (name + discordRoleId)
      [{ name: 'Old Party', discordRoleId: 'role-old' }],
      // all active parties
      [{ id: 'party-new', name: 'Reform Party', shortName: 'REF', discordRoleId: 'role-new', isActive: true }],
    ];

    await executeChangeParty(interaction);

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ partyId: 'party-new' }));
    expect(mocks.updateSets).toContainEqual({ leaderId: null });
    expect(mocks.insertValues[0]).toMatchObject({
      playerId: 'target-player',
      eventType: 'party_change',
      oldValue: { partyId: 'party-old', partyName: 'Old Party' },
      newValue: { partyId: 'party-new', partyName: 'Reform Party' },
      triggeredById: 'staff-player',
    });
    expect(interaction.guild.members.fetch).toHaveBeenCalledWith('target-discord');
    expect(interaction.targetMember.roles.remove).toHaveBeenCalledWith('role-old');
    expect(interaction.targetMember.roles.add).toHaveBeenCalledWith('role-new');
  });

  it('clears the old party leader and removes the Discord role when staff sets a player to independent', async () => {
    const interaction = fakeChangePartyInteraction();
    interaction.options.getString = vi.fn(() => 'independent');

    mocks.selectRows = [
      [{
        id: 'target-player',
        discordId: 'target-discord',
        characterName: 'Aldrick Vance',
        partyId: 'party-old',
      }],
      [{ id: 'staff-player' }],
      [{ name: 'Old Party', discordRoleId: 'role-old' }],
    ];

    await executeChangeParty(interaction);

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ partyId: null }));
    expect(mocks.updateSets).toContainEqual({ leaderId: null });
    expect(interaction.targetMember.roles.remove).toHaveBeenCalledWith('role-old');
    expect(interaction.targetMember.roles.add).not.toHaveBeenCalled();
  });
});
