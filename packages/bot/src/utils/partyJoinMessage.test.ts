import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  txSelectRows: [] as unknown[][],
  updateSet: null as Record<string, unknown> | null,
  updateSets: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ and: args })),
  asc: vi.fn((field) => ({ asc: field })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  parties: {
    id: 'parties.id',
    name: 'parties.name',
    shortName: 'parties.shortName',
    ideology: 'parties.ideology',
    colour: 'parties.colour',
    discordRoleId: 'parties.discordRoleId',
    leaderId: 'parties.leaderId',
    isActive: 'parties.isActive',
    isInviteOnly: 'parties.isInviteOnly',
  },
  players: {
    id: 'players.id',
    discordId: 'players.discordId',
    isAlive: 'players.isAlive',
    partyId: 'players.partyId',
    lastActiveAt: 'players.lastActiveAt',
  },
  playerEventLog: {
    playerId: 'playerEventLog.playerId',
  },
}));

vi.mock('../db.js', () => ({
  db: mocks.db,
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

function partyJoinMessage(description = 'React with the emoji for the open party you want to join.\n\n🔵 **Blue Party** (BLU) — Ideology: *Liberal conservatism*') {
  const message: any = {
    id: 'message-1',
    channelId: '1501608247411609646',
    createdTimestamp: 2000,
    author: { id: 'bot-user' },
    client: { user: { id: 'bot-user' } },
    embeds: [{
      title: '🏛️ Join a Party',
      description,
    }],
    guild: null,
  };

  message.channel = {
    messages: {
      fetch: vi.fn().mockResolvedValue(new Map([[message.id, message]])),
    },
  };

  return message;
}

import {
  buildPartyJoinMessagePayload,
  handlePartyJoinReaction,
  refreshPartyJoinMessage,
} from './partyJoinMessage';

describe('party join reaction message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PARTY_JOIN_MESSAGE_ID;
    mocks.updateSet = null;
    mocks.updateSets = [];
    mocks.insertValues = [];
    mocks.txSelectRows = [];
    mocks.db.select.mockImplementation(() => new Query([]));
    mocks.db.update.mockReturnValue(new UpdateQuery());
    mocks.db.insert.mockReturnValue(new InsertQuery());
    mocks.tx.select.mockImplementation(() => new Query(mocks.txSelectRows.shift() ?? []));
    mocks.tx.update.mockReturnValue(new UpdateQuery());
    mocks.tx.insert.mockReturnValue(new InsertQuery());
    mocks.db.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx));
  });

  it('lists only open parties, includes ideology, and assigns nearest unique colour emoji', () => {
    const payload = buildPartyJoinMessagePayload([
      {
        id: 'red-1',
        name: 'Red League',
        shortName: 'RED',
        ideology: 'Market socialism',
        colour: '#f31d1d',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: false,
      },
      {
        id: 'private',
        name: 'Closed Caucus',
        shortName: null,
        ideology: 'Patronage',
        colour: '#222222',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: true,
      },
      {
        id: 'red-2',
        name: 'Crimson Union',
        shortName: null,
        ideology: 'Syndicalism',
        colour: '#d61c1c',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: false,
      },
      {
        id: 'blue',
        name: 'Blue Party',
        shortName: 'BLU',
        ideology: 'Liberal conservatism',
        colour: '#1751d8',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: false,
      },
    ]);

    expect(payload.options.map((option) => option.party.id)).toEqual(['red-1', 'red-2', 'blue']);
    expect(payload.options.map((option) => option.emoji)).toEqual(['🔴', '🟥', '🔵']);
    expect(payload.reactionEmojis).toEqual(['🔴', '🟥', '🔵']);

    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Market socialism');
    expect(embed.description).toContain('Syndicalism');
    expect(embed.description).toContain('Liberal conservatism');
    expect(embed.description).not.toContain('Closed Caucus');
  });

  it('refreshes the current join board when parties change and keeps existing emoji assignments stable', async () => {
    mocks.db.select.mockImplementation(() => new Query([
      {
        id: 'aqua',
        name: 'Aqua Bloc',
        shortName: 'AQU',
        ideology: 'Maritime municipalism',
        colour: '#1751d8',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: false,
      },
      {
        id: 'blue',
        name: 'Blue Party',
        shortName: 'BLU',
        ideology: 'Liberal conservatism',
        colour: '#1751d8',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: false,
      },
      {
        id: 'private',
        name: 'Closed Caucus',
        shortName: null,
        ideology: 'Patronage',
        colour: '#222222',
        discordRoleId: null,
        isActive: true,
        isInviteOnly: true,
      },
    ]));

    const message = partyJoinMessage([
      'React with the emoji for the open party you want to join.',
      'Invite-only parties are not listed.',
      '',
      '🔵 **Blue Party** (BLU) — Ideology: *Liberal conservatism*',
    ].join('\n'));
    message.edit = vi.fn().mockResolvedValue(message);
    message.react = vi.fn().mockResolvedValue(undefined);

    const channel = {
      messages: {
        fetch: vi.fn().mockResolvedValue(new Map([[message.id, message]])),
      },
    };
    message.channel = channel;

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue(channel),
      },
    };

    await refreshPartyJoinMessage(client as any);

    expect(message.edit).toHaveBeenCalledWith({ embeds: expect.any(Array) });
    const editPayload = message.edit.mock.calls[0]?.[0];
    const embed = editPayload.embeds[0].toJSON();
    expect(embed.description).toContain('🟦 **Aqua Bloc** (AQU) — Ideology: *Maritime municipalism*');
    expect(embed.description).toContain('🔵 **Blue Party** (BLU) — Ideology: *Liberal conservatism*');
    expect(embed.description).not.toContain('Closed Caucus');
    expect(message.react).toHaveBeenCalledWith('🟦');
    expect(message.react).toHaveBeenCalledWith('🔵');
  });

  it('moves a character into the party selected by reaction and syncs roles', async () => {
    mocks.txSelectRows = [
      [
        {
          id: 'party-new',
          name: 'Blue Party',
          shortName: 'BLU',
          ideology: 'Liberal conservatism',
          colour: '#1751d8',
          discordRoleId: 'role-new',
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'player-1',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: 'Ada Vance',
          isAlive: true,
          partyId: 'party-old',
        },
      ],
      [
        { name: 'Old Party', discordRoleId: 'role-old' },
      ],
    ];

    const reactionRemove = vi.fn().mockResolvedValue(undefined);
    const roleRemove = vi.fn().mockResolvedValue(undefined);
    const roleAdd = vi.fn().mockResolvedValue(undefined);
    const member = { roles: { remove: roleRemove, add: roleAdd } };
    const userSend = vi.fn().mockResolvedValue(undefined);

    await handlePartyJoinReaction(
      {
        message: {
          ...partyJoinMessage(),
          guild: { members: { fetch: vi.fn().mockResolvedValue(member) } },
        },
        emoji: { name: '🔵' },
        users: { remove: reactionRemove },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: userSend,
      } as any,
    );

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ partyId: 'party-new' }));
    expect(mocks.updateSets).toContainEqual({ leaderId: null });
    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.insertValues[0]).toMatchObject({
      playerId: 'player-1',
      eventType: 'party_change',
      oldValue: { partyId: 'party-old', partyName: 'Old Party' },
      newValue: { partyId: 'party-new', partyName: 'Blue Party' },
      triggeredById: 'player-1',
    });
    expect(roleRemove).toHaveBeenCalledWith('role-old');
    expect(roleAdd).toHaveBeenCalledWith('role-new');
    expect(reactionRemove).toHaveBeenCalledWith('discord-user');
    expect(userSend).toHaveBeenCalledWith(expect.stringContaining('joined **Blue Party**'));
  });

  it('uses the posted message line as the emoji-to-party mapping', async () => {
    mocks.txSelectRows = [
      [
        {
          id: 'party-blue',
          name: 'Blue Party',
          shortName: 'BLU',
          ideology: 'Liberal conservatism',
          colour: '#1751d8',
          discordRoleId: null,
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'player-1',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: 'Ada Vance',
          isAlive: true,
          partyId: null,
        },
      ],
    ];

    await handlePartyJoinReaction(
      {
        message: partyJoinMessage(),
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    expect(mocks.updateSets).toContainEqual(expect.objectContaining({ partyId: 'party-blue' }));
    expect(mocks.insertValues[0]).toMatchObject({
      newValue: { partyId: 'party-blue', partyName: 'Blue Party' },
    });
  });

  it('does not join OAuth-only player rows', async () => {
    mocks.txSelectRows = [
      [
        {
          id: 'party-new',
          name: 'Blue Party',
          shortName: 'BLU',
          ideology: 'Liberal conservatism',
          colour: '#1751d8',
          discordRoleId: null,
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'oauth-player',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: null,
          isAlive: true,
          partyId: null,
        },
      ],
    ];

    const userSend = vi.fn().mockResolvedValue(undefined);

    await handlePartyJoinReaction(
      {
        message: partyJoinMessage(),
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: userSend,
      } as any,
    );

    expect(mocks.updateSet).toBeNull();
    expect(mocks.insertValues).toEqual([]);
    expect(userSend).toHaveBeenCalledWith(expect.stringContaining('/character create'));
  });

  it('serializes rapid joins from the same Discord user', async () => {
    const message = partyJoinMessage([
      'React with the emoji for the open party you want to join.',
      '',
      '🔵 **Blue Party** (BLU) — Ideology: *Liberal conservatism*',
      '🔴 **Red League** (RED) — Ideology: *Market socialism*',
    ].join('\n'));
    let releaseFirst!: () => void;

    mocks.db.transaction
      .mockImplementationOnce((fn: (tx: typeof mocks.tx) => Promise<unknown>) => new Promise((resolve) => {
        releaseFirst = () => {
          void fn(mocks.tx).then(resolve);
        };
      }))
      .mockImplementationOnce(async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx));

    mocks.txSelectRows = [
      [
        {
          id: 'party-blue',
          name: 'Blue Party',
          shortName: 'BLU',
          ideology: 'Liberal conservatism',
          colour: '#1751d8',
          discordRoleId: null,
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'player-1',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: 'Ada Vance',
          isAlive: true,
          partyId: null,
        },
      ],
      [
        {
          id: 'party-red',
          name: 'Red League',
          shortName: 'RED',
          ideology: 'Market socialism',
          colour: '#f31d1d',
          discordRoleId: null,
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'player-1',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: 'Ada Vance',
          isAlive: true,
          partyId: 'party-blue',
        },
      ],
      [
        { name: 'Blue Party', discordRoleId: null },
      ],
    ];

    const user = {
      id: 'discord-user',
      bot: false,
      partial: false,
      send: vi.fn().mockResolvedValue(undefined),
    } as any;

    const first = handlePartyJoinReaction(
      {
        message,
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      user,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = handlePartyJoinReaction(
      {
        message,
        emoji: { name: '🔴' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      user,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      expect(mocks.db.transaction).toHaveBeenCalledTimes(1);

      releaseFirst();
      await Promise.all([first, second]);

      expect(mocks.db.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.insertValues.map((entry) => entry.newValue)).toEqual([
        { partyId: 'party-blue', partyName: 'Blue Party' },
        { partyId: 'party-red', partyName: 'Red League' },
      ]);
    } finally {
      releaseFirst?.();
      await Promise.allSettled([first, second]);
    }
  });

  it('does not join dead characters', async () => {
    mocks.txSelectRows = [
      [
        {
          id: 'party-new',
          name: 'Blue Party',
          shortName: 'BLU',
          ideology: 'Liberal conservatism',
          colour: '#1751d8',
          discordRoleId: null,
          isActive: true,
          isInviteOnly: false,
        },
      ],
      [
        {
          id: 'dead-player',
          discordId: 'discord-user',
          discordUsername: 'Ada',
          characterName: 'Ada Vance',
          isAlive: false,
          partyId: null,
        },
      ],
    ];

    const userSend = vi.fn().mockResolvedValue(undefined);

    await handlePartyJoinReaction(
      {
        message: partyJoinMessage(),
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: userSend,
      } as any,
    );

    expect(mocks.updateSet).toBeNull();
    expect(mocks.insertValues).toEqual([]);
    expect(userSend).toHaveBeenCalledWith(expect.stringContaining('dead characters cannot join parties'));
  });

  it('ignores join-board reactions when a configured message id does not match', async () => {
    process.env.PARTY_JOIN_MESSAGE_ID = 'current-message';

    const handled = await handlePartyJoinReaction(
      {
        message: partyJoinMessage(),
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    expect(handled).toBe(false);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it('ignores stale bot-authored join boards when no message id is configured', async () => {
    const stale = partyJoinMessage();
    stale.id = 'stale-message';
    stale.createdTimestamp = 1000;

    const current = partyJoinMessage();
    current.id = 'current-message';
    current.createdTimestamp = 2000;

    stale.channel.messages.fetch.mockResolvedValue(new Map([
      [stale.id, stale],
      [current.id, current],
    ]));

    const handled = await handlePartyJoinReaction(
      {
        message: stale,
        emoji: { name: '🔵' },
        users: { remove: vi.fn().mockResolvedValue(undefined) },
      } as any,
      {
        id: 'discord-user',
        bot: false,
        partial: false,
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    expect(handled).toBe(false);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });
});
