import { beforeEach, describe, expect, it, vi } from 'vitest';
import partyCommand from './party.js';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; shortName: string | null }>,
  selectRows: [] as unknown[][],
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  isStaff: vi.fn(),
  updateSet: null as Record<string, unknown> | null,
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
    mocks.updateSet = values;
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

function optionFromSubcommand(subcommandName: string, optionName: string) {
  const json = partyCommand.data.toJSON();
  const subcommand = json.options?.find((option) => option.name === subcommandName);
  if (!subcommand || !('options' in subcommand)) throw new Error(`Missing /party ${subcommandName} subcommand`);

  const option = subcommand.options?.find((candidate) => candidate.name === optionName);
  if (!option) throw new Error(`Missing /party ${subcommandName} ${optionName} option`);
  return option;
}

function joinPartyOption() {
  return optionFromSubcommand('join', 'party');
}

function assignPartyOption() {
  return optionFromSubcommand('assign', 'party');
}

function fakeAssignInteraction() {
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
      getSubcommand: vi.fn(() => 'assign'),
      getUser: vi.fn(() => ({
        id: 'target-discord',
        username: 'TargetUser',
        toString: () => '<@target-discord>',
      })),
      getString: vi.fn(() => 'party-new'),
    },
    targetMember,
  } as any;
}

describe('/party', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.selectRows = [];
    mocks.updateSet = null;
    mocks.updateSets = [];
    mocks.insertValues = [];
    mocks.isStaff.mockResolvedValue(true);
    mocks.select.mockImplementation(() => new Query(mocks.selectRows.shift() ?? mocks.rows));
    mocks.update.mockReturnValue(new UpdateQuery());
    mocks.insert.mockReturnValue(new InsertQuery());
  });

  it('offers autocomplete for the join party option', () => {
    expect(joinPartyOption().autocomplete).toBe(true);
    expect(typeof partyCommand.autocomplete).toBe('function');
  });

  it('offers a staff assign subcommand with party autocomplete', () => {
    expect(optionFromSubcommand('assign', 'user').required).toBe(true);
    expect(assignPartyOption().autocomplete).toBe(true);
  });

  it('suggests active parties by name or short name', async () => {
    mocks.rows = [
      { id: 'party-1', name: 'Reform Party', shortName: 'REF' },
      { id: 'party-2', name: 'Unity League', shortName: null },
    ];
    mocks.select.mockReturnValue(new Query(mocks.rows));

    const interaction = {
      options: {
        getFocused: vi.fn(() => ({ name: 'party', value: 'ref' })),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    };

    await partyCommand.autocomplete?.(interaction as any);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Reform Party (REF)', value: 'party-1' },
    ]);
  });

  it('lets staff assign another character to an active party', async () => {
    const interaction = fakeAssignInteraction();
    mocks.selectRows = [
      [{
        id: 'target-player',
        discordId: 'target-discord',
        characterName: 'Aldrick Vance',
        partyId: 'party-old',
      }],
      [{ id: 'staff-player' }],
      [{ id: 'party-new', name: 'Reform Party', shortName: 'REF', discordRoleId: 'role-new' }],
      [{ name: 'Old Party', discordRoleId: 'role-old' }],
    ];

    await partyCommand.execute(interaction);

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

  it('clears the old party leader when leaving your party', async () => {
    const interaction = {
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      user: { id: 'player-discord', toString: () => '<@player-discord>' },
      guild: {
        members: {
          cache: new Map([
            ['player-discord', { roles: { remove: vi.fn().mockResolvedValue(undefined) } }],
          ]),
        },
      },
      options: {
        getSubcommand: vi.fn(() => 'leave'),
      },
    } as any;

    mocks.selectRows = [
      [{
        id: 'player-1',
        discordId: 'player-discord',
        characterName: 'Ada Vance',
        partyId: 'party-old',
      }],
      [{ name: 'Old Party', discordRoleId: 'role-old' }],
    ];

    await partyCommand.execute(interaction);

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ partyId: null }));
    expect(mocks.updateSets).toContainEqual({ leaderId: null });
    expect(mocks.insertValues[0]).toMatchObject({
      oldValue: { partyId: 'party-old', partyName: 'Old Party' },
      newValue: { partyId: null, partyName: 'Independent' },
    });
  });
});
