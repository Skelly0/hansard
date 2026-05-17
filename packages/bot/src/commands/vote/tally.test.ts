import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  findElectionByReference: vi.fn(),
  hasPermission: vi.fn(),
  tallyVotes: vi.fn(),
  autoEnactPassedBillFromElection: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  candidates: {
    electionId: 'candidates.electionId',
    playerId: 'candidates.playerId',
  },
  players: {
    id: 'players.id',
    characterName: 'players.characterName',
    discordUsername: 'players.discordUsername',
  },
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

vi.mock('@hansard/api/services/voteService', () => ({
  VoteService: class {
    tallyVotes = mocks.tallyVotes;
  },
}));

vi.mock('../bills/autoEnact.js', () => ({
  autoEnactPassedBillFromElection: mocks.autoEnactPassedBillFromElection,
}));

import { execute } from './tally.js';

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    client: { channels: { fetch: vi.fn() } },
    options: {
      getString: vi.fn(() => 'Bridge Security Act'),
    },
  };
}

describe('/vote tally auto-enactment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.db.select.mockReturnValue(selectRows([]));
    mocks.tallyVotes.mockResolvedValue({
      totalVotes: 3,
      turnout: 3,
      finalTallies: { yea: 2, nay: 1, abstain: 0 },
      passed: true,
      winners: ['yea'],
    });
    mocks.autoEnactPassedBillFromElection.mockResolvedValue({ status: 'enacted' });
  });

  it('auto-enacts a linked legislative bill after a successful manual tally', async () => {
    const election = {
      id: 'election-1',
      title: 'Bridge Security Act',
      type: 'legislative_vote',
      method: 'yea_nay_abstain',
      status: 'voting_closed',
      relatedBillId: 'bill-1',
      createdById: 'creator-player',
    };
    mocks.findElectionByReference.mockResolvedValue({
      election,
      errorMessage: null,
      reference: { kind: 'title', value: election.title },
    });
    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.tallyVotes).toHaveBeenCalledWith(election.id);
    expect(mocks.autoEnactPassedBillFromElection).toHaveBeenCalledWith({
      database: mocks.db,
      client: interaction.client,
      election,
    });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });
});
