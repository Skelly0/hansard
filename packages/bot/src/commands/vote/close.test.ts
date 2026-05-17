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
  tallyVotes: vi.fn(),
  autoEnactPassedBillFromElection: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses) => ({ and: clauses })),
  eq: vi.fn((left, right) => ({ left, right })),
  inArray: vi.fn((left, right) => ({ left, right })),
  ilike: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })),
}));

vi.mock('@hansard/db', () => ({
  ballots: {
    electionId: 'ballots.electionId',
    voterId: 'ballots.voterId',
    vote: 'ballots.vote',
  },
  candidates: {
    electionId: 'candidates.electionId',
    playerId: 'candidates.playerId',
    registeredAt: 'candidates.registeredAt',
    isWithdrawn: 'candidates.isWithdrawn',
  },
  elections: {
    id: 'elections.id',
  },
  players: {
    id: 'players.id',
    characterName: 'players.characterName',
    discordUsername: 'players.discordUsername',
    isAlive: 'players.isAlive',
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

vi.mock('@hansard/api/services/voteService', () => ({
  VoteService: class {
    tallyVotes = mocks.tallyVotes;
  },
}));

vi.mock('../bills/autoEnact.js', () => ({
  autoEnactPassedBillFromElection: mocks.autoEnactPassedBillFromElection,
}));

import { execute } from './close';

const openElection = {
  id: 'election-1',
  title: 'Bridge Security Act',
  description: 'Establishes protections and patrol authority.',
  type: 'legislative_vote',
  method: 'yea_nay_abstain',
  status: 'voting_open',
  useReactions: true,
  discordMessageId: 'message-1',
  discordChannelId: 'channel-1',
  config: { majorityType: 'simple', passThreshold: 0.5 },
};

function ballot(choice: 'yea' | 'nay' | 'abstain') {
  return {
    vote: { type: 'yea_nay_abstain', choice },
  };
}

function updateReturning(rows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

/**
 * Build a select-builder mock that resolves to `rows`. Supports the chain
 * shapes used by close.ts:
 *   .from(...).where(...)
 *   .from(...).innerJoin(...).where(...)
 *   .from(...).where(...).orderBy(...)
 *   .from(...).innerJoin(...).where(...).orderBy(...)
 * Every branching method is itself thenable so the awaiter can resolve at
 * whichever level the caller stops chaining.
 */
function selectWhere(rows: unknown[]) {
  const thenable = (value: unknown[]) => ({
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(value).then(resolve),
  });
  const orderBy = vi.fn(() => thenable(rows));
  const where = vi.fn(() => ({
    ...thenable(rows),
    orderBy,
  }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin, orderBy }));
  return { from };
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

describe('/vote close reaction-mode embeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.findElectionByReference.mockResolvedValue({
      election: openElection,
      errorMessage: null,
      reference: { kind: 'title', value: openElection.title },
    });
    mocks.tallyVotes.mockResolvedValue({ passed: true });
    mocks.autoEnactPassedBillFromElection.mockResolvedValue({ status: 'enacted' });
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

    await execute(makeInteraction() as any);

    expect(edit).toHaveBeenCalled();
    expect(removeAll).not.toHaveBeenCalled();
  });

  it('passes reaction-mode supermajorities at exactly two-thirds of yea and nay votes', async () => {
    const election = {
      ...openElection,
      status: 'voting_closed',
      config: { majorityType: 'supermajority', passThreshold: 0.667 },
    };
    const edit = vi.fn().mockResolvedValue(undefined);
    mocks.findElectionByReference.mockResolvedValue({
      election: openElection,
      errorMessage: null,
      reference: { kind: 'title', value: openElection.title },
    });
    mocks.db.update.mockReturnValue(updateReturning([election]));
    mocks.db.select.mockReturnValue(selectWhere([
      ballot('yea'),
      ballot('yea'),
      ballot('nay'),
      ballot('abstain'),
      ballot('abstain'),
    ]));
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit }),
      },
    });

    await execute(makeInteraction() as any);

    const resultEmbed = edit.mock.calls[0]?.[0]?.embeds?.[0];
    expect(resultEmbed?.data.description).toContain('**PASSED**');
    expect(resultEmbed?.data.fields?.[0]?.value).toContain('Abstain: **2**');
    const majorityField = resultEmbed?.data.fields?.find((f: { name: string }) => f.name === 'Majority');
    expect(majorityField?.value).toBe('Supermajority (67%)');
    const typeField = resultEmbed?.data.fields?.find((f: { name: string }) => f.name === 'Type');
    expect(typeField?.value).toBe('Legislative Vote');
    const methodField = resultEmbed?.data.fields?.find((f: { name: string }) => f.name === 'Method');
    expect(methodField?.value).toBe('Yea / Nay / Abstain');
  });

  it('does not pass tied simple-majority reaction votes', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    mocks.db.select.mockReturnValue(selectWhere([
      ballot('yea'),
      ballot('nay'),
    ]));
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit }),
      },
    });

    await execute(makeInteraction() as any);

    const resultEmbed = edit.mock.calls[0]?.[0]?.embeds?.[0];
    expect(resultEmbed?.data.description).toContain('**REJECTED**');
  });

  it('auto-tallies legislative votes that have a linked bill so the bill transitions', async () => {
    const election = {
      ...openElection,
      relatedBillId: 'bill-1',
      status: 'voting_closed',
    };
    mocks.db.update.mockReturnValue(updateReturning([election]));
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit: vi.fn() }),
      },
    });

    await execute(makeInteraction() as any);

    expect(mocks.tallyVotes).toHaveBeenCalledWith(election.id);
    expect(mocks.autoEnactPassedBillFromElection).toHaveBeenCalledWith(expect.objectContaining({
      client: mocks.client,
      database: mocks.db,
      election,
    }));
  });

  it('does not tally legislative votes that have no linked bill', async () => {
    const election = { ...openElection, status: 'voting_closed' };
    mocks.db.update.mockReturnValue(updateReturning([election]));
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit: vi.fn() }),
      },
    });

    await execute(makeInteraction() as any);

    expect(mocks.tallyVotes).not.toHaveBeenCalled();
  });

  it('excludes ballots from dead voters in the reaction-mode yea/nay tally (BOT-3)', async () => {
    // The ballot select must inner-join players and filter players.isAlive=true
    // so a yea ballot from a now-dead voter is not counted in the rendered
    // result. We verify that by inspecting the select mock chain: if the
    // implementation no longer joins/filters, the test fails.
    const election = { ...openElection, status: 'voting_closed' };
    const edit = vi.fn().mockResolvedValue(undefined);
    mocks.db.update.mockReturnValue(updateReturning([election]));

    // Simulate the DB applying the isAlive filter at the query layer:
    // only the alive voter's ballot is returned to the bot.
    mocks.db.select.mockReturnValue(selectWhere([
      // dead voter's yea ballot is filtered out at the join — not present here
      ballot('nay'), // alive voter
    ]));
    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit }),
      },
    });

    await execute(makeInteraction() as any);

    // The yea-from-dead-voter should NOT appear in the result; result must
    // be REJECTED with yea=0 and nay=1.
    const resultEmbed = edit.mock.calls[0]?.[0]?.embeds?.[0];
    expect(resultEmbed?.data.description).toContain('**REJECTED**');
    const resultField = resultEmbed?.data.fields?.find((f: { name: string }) => f.name === 'Result');
    expect(resultField?.value).toContain('Yea: **0**');
    expect(resultField?.value).toContain('Nay: **1**');

    // And the chain itself must include an innerJoin call so future
    // regressions that drop the join are caught even if the test DB returns
    // dead voters anyway.
    const builder = mocks.db.select.mock.results[0]?.value;
    const fromResult = builder?.from?.mock?.results?.[0]?.value;
    expect(fromResult?.innerJoin).toBeDefined();
    expect(fromResult.innerJoin).toHaveBeenCalled();
  });

  it('does not render withdrawn FPTP candidates in reaction-mode results (BOT-4)', async () => {
    const election = {
      ...openElection,
      method: 'fptp',
      status: 'voting_closed',
    };
    const edit = vi.fn().mockResolvedValue(undefined);
    mocks.db.update.mockReturnValue(updateReturning([election]));

    // First select call: ballots (one FPTP ballot for the active candidate).
    // Second select call: candidates — only active (non-withdrawn) row.
    // Third select call: players — name lookup for that candidate.
    mocks.db.select
      .mockReturnValueOnce(selectWhere([
        { vote: { type: 'fptp', candidateId: 'player-active' } },
      ]))
      .mockReturnValueOnce(selectWhere([
        { playerId: 'player-active', isWithdrawn: false },
      ]))
      .mockReturnValueOnce(selectWhere([
        { id: 'player-active', name: 'Active Candidate', fallback: 'active' },
      ]));

    mocks.client.channels.fetch.mockResolvedValue({
      messages: {
        fetch: vi.fn().mockResolvedValue({ edit }),
      },
    });

    await execute(makeInteraction() as any);

    const resultEmbed = edit.mock.calls[0]?.[0]?.embeds?.[0];
    const resultField = resultEmbed?.data.fields?.find((f: { name: string }) => f.name === 'Result');
    expect(resultField?.value).toContain('Active Candidate');
    expect(resultField?.value).not.toContain('Withdrawn');

    // Verify the candidate select chain itself filtered out withdrawn rows:
    // the candidate query is the second call; it should call .where with an
    // `and(...)` clause (i.e. multiple predicates including isWithdrawn=false).
    const candidatesBuilder = mocks.db.select.mock.results[1]?.value;
    const candidatesFrom = candidatesBuilder?.from?.mock?.results?.[0]?.value;
    expect(candidatesFrom?.where).toHaveBeenCalled();
    const whereArg = candidatesFrom?.where?.mock?.calls?.[0]?.[0];
    // `and(...)` mock returns `{ and: clauses }`; bare `eq(...)` would not.
    expect(whereArg?.and).toBeDefined();
  });
});
