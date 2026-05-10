import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    channels: {
      fetch: vi.fn(),
    },
  },
  db: {
    update: vi.fn(),
    select: vi.fn(),
  },
  findElectionByReference: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  inArray: vi.fn((left, right) => ({ left, right })),
  ilike: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })),
}));

vi.mock('@hansard/db', () => ({
  ballots: {
    electionId: 'ballots.electionId',
  },
  candidates: {
    electionId: 'candidates.electionId',
    playerId: 'candidates.playerId',
    registeredAt: 'candidates.registeredAt',
  },
  elections: {
    id: 'elections.id',
  },
  players: {
    id: 'players.id',
    characterName: 'players.characterName',
    discordUsername: 'players.discordUsername',
  },
}));

vi.mock('../../client.js', () => ({
  client: mocks.client,
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('./_electionReference.js', () => ({
  findElectionByReference: mocks.findElectionByReference,
}));

import command from './close';

const openElection = {
  id: 'election-1',
  title: 'Bridge Security Act',
  description: 'Establishes protections and patrol authority.',
  method: 'yea_nay_abstain',
  status: 'voting_open',
  useReactions: true,
  discordMessageId: 'message-1',
  discordChannelId: 'channel-1',
  config: { majorityType: 'simple', passThreshold: 0.5 },
};

function updateReturning(rows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function selectWhere(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

function makeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    options: {
      getString: vi.fn(() => 'Bridge Security Act'),
    },
    channel: null,
  };
}

describe('/vote-close reaction-mode embeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.findElectionByReference.mockResolvedValue({
      election: openElection,
      errorMessage: null,
      reference: { kind: 'title', value: openElection.title },
    });
    mocks.db.update.mockReturnValue(updateReturning([{
      ...openElection,
      status: 'voting_closed',
    }]));
    mocks.db.select.mockReturnValue(selectWhere([
      {
        vote: { type: 'yea_nay_abstain', choice: 'yea' },
      },
    ]));
  });

  it('updates the result embed without removing public vote reactions', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const removeAll = vi.fn().mockResolvedValue(undefined);
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({
          edit,
          reactions: { removeAll },
        }),
      },
    });

    await command.execute(makeInteraction() as any);

    expect(edit).toHaveBeenCalled();
    expect(removeAll).not.toHaveBeenCalled();
  });
});
