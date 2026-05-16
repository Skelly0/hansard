import { describe, expect, it, vi } from 'vitest';
import { createVoteOnBill, enactBill, getVoters, listBills } from './billService';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function billRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    title: 'Transit Reform Act',
    shortTitle: null,
    slug: 'transit-reform-act',
    billNumber: 1,
    billType: 'google_doc',
    googleDocUrl: 'https://docs.google.com/document/d/doc-id',
    googleDocId: 'doc-id',
    cachedContent: null,
    cachedAt: null,
    summary: null,
    authorId: 'author-1',
    submittedById: 'submitter-1',
    coSponsorIds: [],
    status: 'submitted',
    submittedAt: baseDate,
    playerVoteId: null,
    playerVoteResult: null,
    playerVoteAt: null,
    npcVoteRequired: true,
    npcVote: null,
    enactedAt: null,
    effectiveAt: null,
    repealedAt: null,
    repealedByBillId: null,
    collectionId: null,
    parentDocumentId: null,
    amendsBillId: null,
    amendsDocumentId: null,
    tags: [],
    policyAreas: [],
    crossReferences: [],
    estimatedEffects: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

function makeListBillsMockDb(billRows: any[], playerRows: any[]) {
  const billsOffset = vi.fn().mockResolvedValue(billRows);
  const billsLimit = vi.fn().mockReturnValue({ offset: billsOffset });
  const billsOrderBy = vi.fn().mockReturnValue({ limit: billsLimit });
  const billsWhere = vi.fn().mockReturnValue({ orderBy: billsOrderBy });
  const billsFrom = vi.fn().mockReturnValue({ where: billsWhere });

  const countWhere = vi.fn().mockResolvedValue([{ value: billRows.length }]);
  const countFrom = vi.fn().mockReturnValue({ where: countWhere });

  const playersWhere = vi.fn().mockResolvedValue(playerRows);
  const playersFrom = vi.fn().mockReturnValue({ where: playersWhere });

  const select = vi.fn()
    .mockReturnValueOnce({ from: billsFrom })
    .mockReturnValueOnce({ from: countFrom })
    .mockReturnValueOnce({ from: playersFrom });

  return { select, playersWhere };
}

describe('listBills', () => {
  it('includes author display data for the bills webapp section', async () => {
    const db: any = makeListBillsMockDb(
      [billRow({ coSponsorIds: ['co-sponsor-1', 'missing-player'] })],
      [
        { id: 'author-1', characterName: 'Ada Vance', discordUsername: 'ada' },
        { id: 'submitter-1', characterName: null, discordUsername: 'clerk' },
        { id: 'co-sponsor-1', characterName: 'Beatrice Cole', discordUsername: 'bea' },
      ],
    );

    const result = await listBills(db);

    expect(result.total).toBe(1);
    expect(result.bills[0]).toMatchObject({
      author: { id: 'author-1', characterName: 'Ada Vance', discordUsername: 'ada' },
      submittedBy: { id: 'submitter-1', characterName: null, discordUsername: 'clerk' },
      coSponsors: [
        { id: 'co-sponsor-1', characterName: 'Beatrice Cole', discordUsername: 'bea' },
      ],
    });
    expect(result.bills[0]?.coSponsors).toHaveLength(1);
  });

  it('maps short bills without a Google Doc URL', async () => {
    const db: any = makeListBillsMockDb(
      [billRow({
        billType: 'short',
        googleDocUrl: null,
        googleDocId: null,
        cachedContent: 'Section 1. The plaza shall be open on weekends.',
      })],
      [
        { id: 'author-1', characterName: 'Ada Vance', discordUsername: 'ada' },
        { id: 'submitter-1', characterName: null, discordUsername: 'clerk' },
      ],
    );

    const result = await listBills(db);

    expect(result.bills[0]).toMatchObject({
      billType: 'short',
      googleDocUrl: null,
      googleDocId: null,
      cachedContent: 'Section 1. The plaza shall be open on weekends.',
    });
  });
});

describe('getVoters', () => {
  function makeMockDb(billRows: any[], ballotRows: any[], electionRows: any[] = [{
    status: 'tallied',
    config: {},
  }]) {
    const billLimit = vi.fn().mockResolvedValue(billRows);
    const billWhere = vi.fn().mockReturnValue({ limit: billLimit });
    const billFrom = vi.fn().mockReturnValue({ where: billWhere });

    const electionLimit = vi.fn().mockResolvedValue(electionRows);
    const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
    const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });

    const orderBy = vi.fn().mockResolvedValue(ballotRows);
    const ballotWhere = vi.fn().mockReturnValue({ orderBy });
    const innerJoin = vi.fn().mockReturnValue({ where: ballotWhere });
    const ballotFrom = vi.fn().mockReturnValue({ innerJoin });

    const select = vi.fn()
      .mockReturnValueOnce({ from: billFrom })
      .mockReturnValueOnce({ from: electionFrom })
      .mockReturnValueOnce({ from: ballotFrom });

    return { select, billFrom, ballotFrom, electionFrom, innerJoin };
  }

  it('returns player ids and display names for bill player votes', async () => {
    const db: any = makeMockDb(
      [{ id: 'bill-1', playerVoteId: 'election-1', npcVote: null }],
      [{
        ballot: {
          voterId: 'player-1',
          vote: { type: 'yea_nay_abstain', choice: 'yea' },
          castAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        characterName: 'Ada Vance',
        discordUsername: 'ada',
      }],
    );

    const result = await getVoters(db, 'bill-slug');

    expect(result?.playerVotes).toEqual([{
      voterId: 'player-1',
      playerId: 'player-1',
      characterName: 'Ada Vance',
      choice: 'yea',
      castAt: '2026-01-01T00:00:00.000Z',
    }]);
    expect(db.innerJoin).toHaveBeenCalled();
  });

  it('falls back to Discord username when the character name is missing', async () => {
    const db: any = makeMockDb(
      [{ id: 'bill-1', playerVoteId: 'election-1', npcVote: null }],
      [{
        ballot: {
          voterId: 'player-1',
          vote: { type: 'yea_nay_abstain', choice: 'abstain' },
          castAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        characterName: null,
        discordUsername: 'ada',
      }],
    );

    const result = await getVoters(db, 'bill-slug');

    expect(result?.playerVotes[0]?.characterName).toBe('ada');
  });

  it('redacts linked election voters for non-staff before results are public', async () => {
    const db: any = makeMockDb(
      [{ id: 'bill-1', playerVoteId: 'election-1', npcVote: null }],
      [{
        ballot: {
          voterId: 'player-1',
          vote: { type: 'yea_nay_abstain', choice: 'yea' },
          castAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        characterName: 'Ada Vance',
        discordUsername: 'ada',
      }],
      [{ status: 'voting_open', config: { sealedResults: true } }],
    );

    const result = await getVoters(db, 'bill-slug', {
      userId: 'viewer-player',
      isStaff: false,
    });

    expect(result?.playerVotes).toEqual([]);
    expect(db.innerJoin).not.toHaveBeenCalled();
  });
});

describe('createVoteOnBill transactional safety', () => {
  it('rolls back the election insert and bill update when the status log insert fails', async () => {
    const billLimit = vi.fn().mockResolvedValue([{
      id: 'bill-1',
      title: 'Transit Reform Act',
      slug: 'transit-reform-act',
      summary: 'A reform',
      billNumber: 1,
      status: 'submitted',
    }]);
    const billWhere = vi.fn().mockReturnValue({ limit: billLimit });
    const billFrom = vi.fn().mockReturnValue({ where: billWhere });

    const select = vi.fn().mockReturnValue({ from: billFrom });

    // tx mocks: election insert + bill update succeed, status log insert throws.
    const electionInsertReturning = vi.fn().mockResolvedValue([{ id: 'election-1' }]);
    const billUpdateReturning = vi.fn().mockResolvedValue([{
      id: 'bill-1',
      title: 'Transit Reform Act',
      slug: 'transit-reform-act',
      status: 'voting',
    }]);
    const statusLogValues = vi.fn().mockRejectedValue(new Error('status log insert failed'));

    const insert = vi.fn(() => {
      // First insert is the elections row; second is the bill_status_log row.
      if (insert.mock.calls.length === 1) {
        return { values: vi.fn().mockReturnValue({ returning: electionInsertReturning }) };
      }
      return { values: statusLogValues };
    });

    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: billUpdateReturning }),
      }),
    });

    const tx = { insert, update };
    const transaction = vi.fn(async (fn: (tx: any) => any) => fn(tx));

    const topLevelInsert = vi.fn();
    const topLevelUpdate = vi.fn();

    const db: any = {
      select,
      insert: topLevelInsert,
      update: topLevelUpdate,
      transaction,
    };

    await expect(createVoteOnBill(db, 'transit-reform-act', 'creator-player'))
      .rejects.toThrow('status log insert failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(topLevelInsert).not.toHaveBeenCalled();
    expect(topLevelUpdate).not.toHaveBeenCalled();
  });
});

describe('enactBill lifecycle guard', () => {
  it('rejects bills that have not passed a player or NPC vote', async () => {
    const billLimit = vi.fn().mockResolvedValue([billRow({ status: 'submitted' })]);
    const billWhere = vi.fn().mockReturnValue({ limit: billLimit });
    const billFrom = vi.fn().mockReturnValue({ where: billWhere });
    const db: any = {
      select: vi.fn().mockReturnValue({ from: billFrom }),
      transaction: vi.fn(async () => {
        throw new Error('transaction should not run');
      }),
    };

    await expect(enactBill(db, 'transit-reform-act', 'actor-1'))
      .rejects.toThrow(/cannot be enacted/);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
