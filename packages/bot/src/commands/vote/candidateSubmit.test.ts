import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './candidateSubmit.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  findElectionByReference: vi.fn(),
  seedReactionForNewCandidate: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}));

vi.mock('./_electionReference.js', () => ({
  findElectionByReference: mocks.findElectionByReference,
}));

vi.mock('./_seedFptpReactions.js', () => ({
  seedReactionForNewCandidate: mocks.seedReactionForNewCandidate,
}));

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
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

describe('/vote candidate-submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.findElectionByReference.mockReset();
    mocks.seedReactionForNewCandidate.mockReset();
    mocks.findElectionByReference.mockResolvedValue({
      election: {
        id: 'election-1',
        title: 'Chancellor Election',
        status: 'nominations_open',
        useReactions: false,
        method: 'fptp',
      },
      errorMessage: null,
    });
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'candidate-1', partyId: null }]),
      }),
    });
  });

  it('rejects dead characters before registering a candidacy', async () => {
    mocks.select
      .mockReturnValueOnce(selectLimit([{
        id: 'dead-player',
        discordUsername: 'ada',
        characterName: 'Ada Mortalis',
        partyId: null,
        isAlive: false,
      }]));

    const interaction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
      client: {},
      user: { id: 'discord-user-1' },
      options: {
        getString: vi.fn((name: string) => (name === 'election' ? 'election-1' : null)),
      },
    };

    await execute(interaction as any);

    expect(mocks.findElectionByReference).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    const replyPayload = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(containsText(replyPayload, /Dead characters cannot stand as candidates/i)).toBe(true);
  });

  it('does not seed reaction emoji while nominations are still open', async () => {
    mocks.findElectionByReference.mockResolvedValue({
      election: {
        id: 'election-1',
        title: 'Chancellor Election',
        status: 'nominations_open',
        useReactions: true,
        method: 'fptp',
        discordMessageId: 'message-1',
        discordChannelId: 'channel-1',
      },
      errorMessage: null,
    });
    mocks.select
      .mockReturnValueOnce(selectLimit([{
        id: 'player-1',
        discordUsername: 'ada',
        characterName: 'Ada Vance',
        partyId: null,
        isAlive: true,
      }]))
      .mockReturnValueOnce(selectLimit([]));

    const interaction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
      client: {},
      user: { id: 'discord-user-1' },
      options: {
        getString: vi.fn((name: string) => (name === 'election' ? 'election-1' : null)),
      },
    };

    await execute(interaction as any);

    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.seedReactionForNewCandidate).not.toHaveBeenCalled();
  });
});
