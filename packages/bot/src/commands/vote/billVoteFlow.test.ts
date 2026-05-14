import { describe, expect, it, vi } from 'vitest';
import { BillStatus, SUPERMAJORITY_PASS_THRESHOLD } from '@hansard/shared';
import {
  buildLegislativeVoteConfig,
  buildSubmittedBillSelectOptions,
  createStandaloneLegislativeVote,
  createLegislativeBillVote,
  STANDALONE_LEGISLATIVE_VOTE_OPTION_VALUE,
} from './billVoteFlow.js';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function submittedBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    title: 'Transit Reform Act',
    billNumber: 1,
    summary: 'Creates a national transit authority.',
    submittedAt: baseDate,
    status: BillStatus.SUBMITTED,
    ...overrides,
  };
}

describe('buildSubmittedBillSelectOptions', () => {
  it('formats at most 25 submitted bills for a Discord select menu', () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      submittedBill({
        id: `bill-${index + 1}`,
        title: `Bill Title ${index + 1}`,
        billNumber: index + 1,
        summary: `Summary ${index + 1}`,
      }),
    );

    const options = buildSubmittedBillSelectOptions(rows);

    expect(options).toHaveLength(25);
    expect(options[0]).toMatchObject({
      label: 'B-001: Bill Title 1',
      value: 'bill-1',
      description: 'Summary 1',
    });
    expect(options[24]?.label).toBe('B-025: Bill Title 25');
  });

  it('can prepend a standalone legislative vote option before submitted bills', () => {
    const options = buildSubmittedBillSelectOptions([submittedBill()], {
      includeStandalone: true,
    });

    expect(options[0]).toMatchObject({
      label: 'Standalone legislative vote',
      value: STANDALONE_LEGISLATIVE_VOTE_OPTION_VALUE,
      description: 'Vote on an agenda item that is not tied to a submitted bill.',
    });
    expect(options[1]).toMatchObject({
      label: 'B-001: Transit Reform Act',
      value: 'bill-1',
    });
  });
});

describe('buildLegislativeVoteConfig', () => {
  it('builds supermajority config for yea/nay legislative votes', () => {
    expect(buildLegislativeVoteConfig('yea_nay_abstain', 'supermajority')).toEqual({
      majorityType: 'supermajority',
      passThreshold: SUPERMAJORITY_PASS_THRESHOLD,
      anonymousBallots: false,
      sealedResults: false,
    });
  });

  it('builds runoff config for two-round legislative votes', () => {
    expect(buildLegislativeVoteConfig('two_round_runoff', 'simple')).toEqual({
      runoffEnabled: true,
      runoffThreshold: 0.5,
      anonymousBallots: false,
      sealedResults: false,
    });
  });
});

describe('createLegislativeBillVote', () => {
  function makeSelectChain(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    return { from, where, limit };
  }

  function makeInsertChain(returnedRows: unknown[], insertValues: unknown[]) {
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const values = vi.fn((value) => {
      insertValues.push(value);
      return { returning };
    });
    const insert = vi.fn().mockReturnValue({ values });
    return { insert, values, returning };
  }

  function makeUpdateChain(returnedRows: unknown[], updateValues: unknown[]) {
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn((value) => {
      updateValues.push(value);
      return { where };
    });
    const update = vi.fn().mockReturnValue({ set });
    return { update, set, where, returning };
  }

  it('links the created election to the selected bill and advances the bill to voting', async () => {
    const bill = submittedBill();
    const actor = { id: 'player-1' };
    const insertedElection = { id: 'election-1' };
    const updatedBill = { ...bill, status: BillStatus.VOTING, playerVoteId: insertedElection.id };

    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const insertValues: unknown[] = [];
    const updateValues: unknown[] = [];
    const txInsert = makeInsertChain([insertedElection], insertValues);
    const txUpdate = makeUpdateChain([updatedBill], updateValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        insert: txInsert.insert,
        update: txUpdate.update,
      })),
    };

    const result = await createLegislativeBillVote(db, {
      billId: bill.id,
      creatorDiscordId: 'discord-1',
      title: 'Vote on: Transit Reform Act',
      description: 'Creates a national transit authority.',
      method: 'yea_nay_abstain',
      majority: 'simple',
      durationHours: 72,
      useReactions: true,
      now: baseDate,
    });

    expect(result.electionId).toBe(insertedElection.id);
    expect(db.select).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: expect.anything(),
      title: expect.anything(),
      billNumber: expect.anything(),
      summary: expect.anything(),
      status: expect.anything(),
    }));
    expect(db.select.mock.calls[0]?.[0]).not.toHaveProperty('billType');
    expect(insertValues[0]).toMatchObject({
      title: 'Vote on: Transit Reform Act',
      type: 'legislative_vote',
      method: 'yea_nay_abstain',
      requiredPermission: 'legislative_leader',
      relatedBillId: bill.id,
      createdById: actor.id,
      status: 'voting_open',
      useReactions: true,
    });
    expect(updateValues[0]).toMatchObject({
      status: BillStatus.VOTING,
      playerVoteId: insertedElection.id,
    });
    expect(txUpdate.returning).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.anything(),
      status: expect.anything(),
      playerVoteId: expect.anything(),
    }));
    expect(txUpdate.returning.mock.calls[0]?.[0]).not.toHaveProperty('billType');
  });

  it('rejects bills that are not still submitted', async () => {
    const billSelect = makeSelectChain([submittedBill({ status: BillStatus.VOTING })]);
    const db: any = {
      select: vi.fn().mockReturnValueOnce({ from: billSelect.from }),
      transaction: vi.fn(),
    };

    await expect(createLegislativeBillVote(db, {
      billId: 'bill-1',
      creatorDiscordId: 'discord-1',
      title: 'Vote on: Transit Reform Act',
      description: null,
      method: 'yea_nay_abstain',
      majority: 'simple',
      durationHours: 48,
      useReactions: false,
      now: baseDate,
    })).rejects.toThrow("Bill is not in 'submitted' status");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects when the bill status drifts between the pre-check and the transaction', async () => {
    const bill = submittedBill();
    const actor = { id: 'player-1' };
    const insertedElection = { id: 'election-1' };

    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const insertValues: unknown[] = [];
    const updateValues: unknown[] = [];
    const txInsert = makeInsertChain([insertedElection], insertValues);
    // Empty returning rows => the status-guard WHERE matched nothing (bill drifted).
    const txUpdate = makeUpdateChain([], updateValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        insert: txInsert.insert,
        update: txUpdate.update,
      })),
    };

    await expect(createLegislativeBillVote(db, {
      billId: bill.id,
      creatorDiscordId: 'discord-1',
      title: 'Vote on: Transit Reform Act',
      description: null,
      method: 'yea_nay_abstain',
      majority: 'simple',
      durationHours: 48,
      useReactions: false,
      now: baseDate,
    })).rejects.toThrow(/may have changed/);
  });
});

describe('createStandaloneLegislativeVote', () => {
  function makeSelectChain(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    return { from, where, limit };
  }

  function makeInsertChain(returnedRows: unknown[], insertValues: unknown[]) {
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const values = vi.fn((value) => {
      insertValues.push(value);
      return { returning };
    });
    const insert = vi.fn().mockReturnValue({ values });
    return { insert, values, returning };
  }

  it('creates a legislative vote without linking or updating a bill', async () => {
    const actor = { id: 'player-1' };
    const insertedElection = { id: 'election-standalone' };
    const actorSelect = makeSelectChain([actor]);
    const insertValues: unknown[] = [];
    const txInsert = makeInsertChain([insertedElection], insertValues);
    const txUpdate = vi.fn();

    const db: any = {
      select: vi.fn().mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        insert: txInsert.insert,
        update: txUpdate,
      })),
    };

    const result = await createStandaloneLegislativeVote(db, {
      creatorDiscordId: 'discord-1',
      title: 'Emergency Bridge Patrol Mandate',
      description: null,
      method: 'yea_nay_abstain',
      majority: 'supermajority',
      durationHours: 24,
      useReactions: false,
      now: baseDate,
    });

    expect(result.electionId).toBe(insertedElection.id);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(insertValues[0]).toMatchObject({
      title: 'Emergency Bridge Patrol Mandate',
      description: null,
      type: 'legislative_vote',
      method: 'yea_nay_abstain',
      requiredPermission: 'legislative_leader',
      relatedBillId: null,
      createdById: actor.id,
      status: 'voting_open',
      useReactions: false,
    });
    expect(txUpdate).not.toHaveBeenCalled();
  });
});
