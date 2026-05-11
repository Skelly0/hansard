import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  findElectionByReference: vi.fn(),
  isStaff: vi.fn(),
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
  players: {
    discordId: 'players.discordId',
  },
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('./_electionReference.js', () => ({
  findElectionByReference: mocks.findElectionByReference,
}));

import command from './eligibility';

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    user: { id: 'discord-user-1' },
    options: {
      getString: vi.fn(() => 'Bridge Security Act'),
    },
  };
}

describe('/vote-eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    mocks.isStaff.mockResolvedValue(false);
    mocks.db.select.mockReturnValue(selectLimit([{
      id: 'player-1',
      characterName: 'Ada Vance',
      discordUsername: 'ada',
      isAlive: true,
      factionId: null,
      partyId: null,
    }]));
  });

  it('reports overdue open votes as closed', async () => {
    mocks.findElectionByReference.mockResolvedValue({
      election: {
        id: 'election-1',
        title: 'Bridge Security Act',
        status: 'voting_open',
        votingClosesAt: new Date('2026-05-11T11:59:59.000Z'),
        config: {},
      },
      errorMessage: null,
    });
    const interaction = makeInteraction();

    await command.execute(interaction as any);

    const embed = interaction.editReply.mock.calls[0]?.[0]?.embeds?.[0];
    expect(embed?.data.description).toContain('cannot vote');
    expect(embed?.data.fields?.find((field: { name: string }) => field.name === 'Eligible')?.value).toBe('No');
    expect(embed?.data.fields?.find((field: { name: string }) => field.name === 'Reason(s)')?.value)
      .toContain('Voting has closed.');
  });
});
