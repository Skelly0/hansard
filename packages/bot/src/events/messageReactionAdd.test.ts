import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';
import { REACTION_CANDIDATE_EMOJIS } from '@hansard/shared';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    delete: vi.fn(),
    insert: vi.fn(),
  },
  insertValues: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  ballots: {
    electionId: 'ballots.electionId',
    voterId: 'ballots.voterId',
  },
  candidates: {
    id: 'candidates.id',
    electionId: 'candidates.electionId',
    isWithdrawn: 'candidates.isWithdrawn',
    playerId: 'candidates.playerId',
    registeredAt: 'candidates.registeredAt',
  },
  elections: {
    discordMessageId: 'elections.discordMessageId',
    id: 'elections.id',
  },
  players: {
    discordId: 'players.discordId',
  },
}));

vi.mock('../db.js', () => ({
  db: mocks.db,
}));

import { registerMessageReactionAddEvent } from './messageReactionAdd';

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function selectOrderBy(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

describe('MessageReactionAdd reaction voting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mocks.tx.insert.mockReturnValue({
      values: mocks.insertValues.mockResolvedValue(undefined),
    });
    mocks.db.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => Promise<void>) => fn(mocks.tx));
  });

  it('records FPTP reaction ballots using candidate player IDs', async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        title: 'Chancellor Election',
        method: 'fptp',
        status: 'voting_open',
        useReactions: true,
        config: {},
      }]))
      .mockReturnValueOnce(selectOrderBy([
        { id: 'candidate-row-1', playerId: 'candidate-player-1' },
      ]))
      .mockReturnValueOnce(selectLimit([{
        id: 'voter-player-1',
        characterName: 'Ada Vance',
        factionId: null,
        partyId: null,
      }]));

    let listener: ((reaction: unknown, user: unknown) => Promise<void>) | undefined;
    registerMessageReactionAddEvent({
      on: vi.fn((event, callback) => {
        if (event === Events.MessageReactionAdd) listener = callback;
      }),
    } as any);

    const remove = vi.fn().mockResolvedValue(undefined);

    await listener!(
      {
        partial: false,
        message: { id: 'message-1' },
        emoji: { name: REACTION_CANDIDATE_EMOJIS[0] },
        users: { remove },
      },
      {
        id: 'discord-user-1',
        bot: false,
        partial: false,
        send: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(mocks.insertValues).toHaveBeenCalledWith({
      electionId: 'election-1',
      voterId: 'voter-player-1',
      vote: { type: 'fptp', candidateId: 'candidate-player-1' },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not record reaction ballots for OAuth-only player rows', async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        title: 'Chancellor Election',
        method: 'fptp',
        status: 'voting_open',
        useReactions: true,
        config: {},
      }]))
      .mockReturnValueOnce(selectOrderBy([
        { id: 'candidate-row-1', playerId: 'candidate-player-1' },
      ]))
      .mockReturnValueOnce(selectLimit([{
        id: 'oauth-placeholder',
        characterName: null,
        factionId: null,
        partyId: null,
      }]));

    let listener: ((reaction: unknown, user: unknown) => Promise<void>) | undefined;
    registerMessageReactionAddEvent({
      on: vi.fn((event, callback) => {
        if (event === Events.MessageReactionAdd) listener = callback;
      }),
    } as any);

    const send = vi.fn().mockResolvedValue(undefined);

    const remove = vi.fn().mockResolvedValue(undefined);

    await listener!(
      {
        partial: false,
        message: { id: 'message-1' },
        emoji: { name: REACTION_CANDIDATE_EMOJIS[0] },
        users: { remove },
      },
      {
        id: 'discord-user-1',
        bot: false,
        partial: false,
        send,
      },
    );

    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining('/character create'));
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not record reaction ballots for dead characters', async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        title: 'Chancellor Election',
        method: 'fptp',
        status: 'voting_open',
        useReactions: true,
        config: {},
      }]))
      .mockReturnValueOnce(selectOrderBy([
        { id: 'candidate-row-1', playerId: 'candidate-player-1' },
      ]))
      .mockReturnValueOnce(selectLimit([{
        id: 'dead-player',
        characterName: 'Ada Vance',
        factionId: null,
        partyId: null,
        isAlive: false,
      }]));

    let listener: ((reaction: unknown, user: unknown) => Promise<void>) | undefined;
    registerMessageReactionAddEvent({
      on: vi.fn((event, callback) => {
        if (event === Events.MessageReactionAdd) listener = callback;
      }),
    } as any);

    const send = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);

    await listener!(
      {
        partial: false,
        message: { id: 'message-1' },
        emoji: { name: REACTION_CANDIDATE_EMOJIS[0] },
        users: { remove },
      },
      {
        id: 'discord-user-1',
        bot: false,
        partial: false,
        send,
      },
    );

    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining('dead characters cannot vote'));
    expect(remove).not.toHaveBeenCalled();
  });
});
