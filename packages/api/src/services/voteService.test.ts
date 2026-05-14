import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoteService } from './voteService';

function makeNpcConfirmDb(election: any, updated = { id: 'election-1', status: 'tallied' }) {
  const limit = vi.fn().mockResolvedValue(election ? [election] : []);
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from });

  const returning = vi.fn().mockResolvedValue([updated]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  return {
    db: { select, update },
    update,
  };
}

function makeTurnoutDb(election: any, ballotRows = [{ id: 'ballot-1' }, { id: 'ballot-2' }]) {
  const electionLimit = vi.fn().mockResolvedValue(election ? [election] : []);
  const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
  const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });

  const ballotsWhere = vi.fn().mockResolvedValue(ballotRows);
  const ballotsFrom = vi.fn().mockReturnValue({ where: ballotsWhere });

  const select = vi.fn()
    .mockReturnValueOnce({ from: electionFrom })
    .mockReturnValueOnce({ from: ballotsFrom });

  return {
    db: { select },
    select,
    ballotsWhere,
  };
}

function makeTallyDb(election: any, allBallotRows: any[], aliveBallotRows = allBallotRows) {
  const electionLimit = vi.fn().mockResolvedValue(election ? [election] : []);
  const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
  const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });

  const legacyBallotWhere = vi.fn().mockResolvedValue(allBallotRows);
  const aliveBallotWhere = vi.fn().mockResolvedValue(aliveBallotRows);
  const innerJoin = vi.fn().mockReturnValue({ where: aliveBallotWhere });
  const ballotFrom = vi.fn().mockReturnValue({
    where: legacyBallotWhere,
    innerJoin,
  });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  // Transactions relay through to the same update/insert spies.
  const tx = { update, insert };
  const transaction = vi.fn(async (fn: (tx: any) => any) => fn(tx));

  const select = vi.fn()
    .mockReturnValueOnce({ from: electionFrom })
    .mockReturnValueOnce({ from: ballotFrom });

  return {
    db: { select, update, insert, transaction },
    legacyBallotWhere,
    aliveBallotWhere,
    innerJoin,
    update,
  };
}

function makeLegislativeTallyDb({
  election,
  aliveBallotRows,
  npcHouseActive,
}: {
  election: any;
  aliveBallotRows: any[];
  npcHouseActive: boolean;
}) {
  const electionLimit = vi.fn().mockResolvedValue(election ? [election] : []);
  const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
  const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });

  const aliveBallotWhere = vi.fn().mockResolvedValue(aliveBallotRows);
  const innerJoin = vi.fn().mockReturnValue({ where: aliveBallotWhere });
  const ballotFrom = vi.fn().mockReturnValue({ innerJoin });

  const clockLimit = vi.fn().mockResolvedValue([{ npcHouseActive }]);
  const clockFrom = vi.fn().mockReturnValue({ limit: clockLimit });

  const updateValues: unknown[] = [];
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn((value) => {
    updateValues.push(value);
    return { where: updateWhere };
  });
  const update = vi.fn().mockReturnValue({ set });

  const statusLogValues: unknown[] = [];
  const values = vi.fn((value) => {
    statusLogValues.push(value);
    return {};
  });
  const insert = vi.fn().mockReturnValue({ values });

  // The tally now runs writes (and the NPC house clock read) inside a
  // transaction. We relay through to shared spies so existing assertions
  // on update/insert payloads keep working, and we serve the clock read
  // from the tx-scoped select.
  const txSelect = vi.fn().mockReturnValue({ from: clockFrom });
  const tx = { select: txSelect, update, insert };
  const transaction = vi.fn(async (fn: (tx: any) => any) => fn(tx));

  const select = vi.fn()
    .mockReturnValueOnce({ from: electionFrom })
    .mockReturnValueOnce({ from: ballotFrom });

  return {
    db: { select, update, insert, transaction },
    updateValues,
    statusLogValues,
  };
}

const validNpcElection = {
  id: 'election-1',
  title: 'Minister Appointment',
  type: 'appointment_confirmation',
  status: 'npc_pending',
  config: { requiresNpcConfirmation: true },
};

function selectLimit(rows: any[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function makeRegisterCandidateDb({
  election = { id: 'election-1', status: 'nominations_open' },
  existingCandidates = [],
  playerRows = [{ id: 'player-1', characterName: 'Ada Vance' }],
}: {
  election?: any;
  existingCandidates?: any[];
  playerRows?: any[];
} = {}) {
  const select = vi.fn()
    .mockReturnValueOnce(selectLimit(election ? [election] : []))
    .mockReturnValueOnce(selectLimit(existingCandidates))
    .mockReturnValueOnce(selectLimit(playerRows));

  const returning = vi.fn().mockResolvedValue([{ id: 'candidate-1' }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return { select, insert };
}

describe('VoteService.enterNpcConfirmation guards', () => {
  it('rejects elections that are not awaiting NPC confirmation', async () => {
    const { db, update } = makeNpcConfirmDb({
      ...validNpcElection,
      status: 'tallied',
    });

    await expect(new VoteService(db as any).enterNpcConfirmation('election-1', {
      yea: 3,
      nay: 1,
      abstain: 0,
      enteredById: 'staff-player',
    })).rejects.toThrow('not awaiting NPC confirmation');

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects elections that do not require NPC confirmation', async () => {
    const { db, update } = makeNpcConfirmDb({
      ...validNpcElection,
      config: { requiresNpcConfirmation: false },
    });

    await expect(new VoteService(db as any).enterNpcConfirmation('election-1', {
      yea: 3,
      nay: 1,
      abstain: 0,
      enteredById: 'staff-player',
    })).rejects.toThrow('does not require NPC confirmation');

    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['string yea', { yea: '10', nay: 1, abstain: 0 }],
    ['negative nay', { yea: 10, nay: -1, abstain: 0 }],
    ['floating abstain', { yea: 10, nay: 1, abstain: 0.5 }],
    ['null yea', { yea: null, nay: 1, abstain: 0 }],
  ])('rejects invalid NPC tally values: %s', async (_name, tally) => {
    const { db, update } = makeNpcConfirmDb(validNpcElection);

    await expect(new VoteService(db as any).enterNpcConfirmation('election-1', {
      ...tally,
      enteredById: 'staff-player',
    } as any)).rejects.toThrow('NPC tally values must be non-negative integers');

    expect(update).not.toHaveBeenCalled();
  });

  it('accepts a pending appointment confirmation that requires NPC confirmation', async () => {
    const { db, update } = makeNpcConfirmDb(validNpcElection);

    const result = await new VoteService(db as any).enterNpcConfirmation('election-1', {
      yea: 3,
      nay: 1,
      abstain: 0,
      enteredById: 'staff-player',
    });

    expect(result).toEqual({ id: 'election-1', status: 'tallied' });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('VoteService.getTurnout privacy', () => {
  it.each([
    ['sealed', { sealedResults: true }],
    ['anonymous', { anonymousBallots: true }],
  ])('hides live %s turnout from non-staff viewers', async (_name, config) => {
    const { db, select, ballotsWhere } = makeTurnoutDb({
      results: null,
      status: 'voting_open',
      config,
      createdById: 'creator-player',
    });

    const result = await new VoteService(db as any).getTurnout('election-1', {
      userId: 'viewer-player',
      isStaff: false,
    });

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
    expect(ballotsWhere).not.toHaveBeenCalled();
  });

  it('allows staff to view live sealed turnout', async () => {
    const { db } = makeTurnoutDb({
      results: { turnout: 4 },
      status: 'voting_open',
      config: { sealedResults: true },
      createdById: 'creator-player',
    }, [{ id: 'ballot-1' }, { id: 'ballot-2' }]);

    await expect(new VoteService(db as any).getTurnout('election-1', {
      userId: 'staff-player',
      isStaff: true,
    })).resolves.toMatchObject({
      electionId: 'election-1',
      eligible: 4,
      voted: 2,
      totalBallots: 2,
    });
  });
});

describe('VoteService character registration guards', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not allow votes after the scheduled close time even if the status is still open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

    const select = vi.fn()
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        status: 'voting_open',
        votingClosesAt: new Date('2026-05-11T11:59:59.000Z'),
        config: {},
        createdById: 'creator-player',
      }]))
      .mockReturnValueOnce(selectLimit([{
        id: 'alive-player',
        characterName: 'Ada Vance',
        factionId: null,
        partyId: null,
        isAlive: true,
      }]))
      .mockReturnValueOnce(selectLimit([]));

    const result = await new VoteService({ select } as any).getEligibility(
      'election-1',
      'alive-player',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'Voting has closed',
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('does not allow OAuth-only rows to vote by default', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        status: 'voting_open',
        config: {},
        createdById: 'creator-player',
      }]))
      .mockReturnValueOnce(selectLimit([{
        id: 'oauth-placeholder',
        characterName: null,
        factionId: null,
        partyId: null,
        isAlive: true,
      }]))
      .mockReturnValueOnce(selectLimit([]));

    const result = await new VoteService({ select } as any).getEligibility(
      'election-1',
      'oauth-placeholder',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'Character registration is required',
    });
  });

  it('does not allow dead character rows to vote', async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectLimit([{
        id: 'election-1',
        status: 'voting_open',
        config: {},
        createdById: 'creator-player',
      }]))
      .mockReturnValueOnce(selectLimit([{
        id: 'dead-player',
        characterName: 'Ada Vance',
        factionId: null,
        partyId: null,
        isAlive: false,
      }]))
      .mockReturnValueOnce(selectLimit([]));

    const result = await new VoteService({ select } as any).getEligibility(
      'election-1',
      'dead-player',
    );

    expect(result).toEqual({
      eligible: false,
      reason: 'Dead characters cannot vote',
    });
  });

  it('does not allow OAuth-only rows to register as candidates', async () => {
    const db = makeRegisterCandidateDb({
      playerRows: [{ id: 'oauth-placeholder', characterName: null }],
    });

    await expect(new VoteService(db as any).registerCandidate({
      electionId: 'election-1',
      playerId: 'oauth-placeholder',
    })).rejects.toThrow('Character registration is required');

    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('VoteService dead voter tally handling', () => {
  it('excludes ballots from dead voters when tallying', async () => {
    const castAt = new Date('2026-05-01T12:00:00.000Z');
    const aliveBallot = {
      id: 'ballot-alive',
      electionId: 'election-1',
      voterId: 'alive-player',
      vote: { type: 'yea_nay_abstain', choice: 'yea' },
      castAt,
    };
    const deadBallot = {
      id: 'ballot-dead',
      electionId: 'election-1',
      voterId: 'dead-player',
      vote: { type: 'yea_nay_abstain', choice: 'nay' },
      castAt,
    };
    const { db, legacyBallotWhere, aliveBallotWhere } = makeTallyDb({
      id: 'election-1',
      method: 'yea_nay_abstain',
      status: 'voting_closed',
      config: {},
    }, [aliveBallot, deadBallot], [aliveBallot]);

    const result = await new VoteService(db as any).tallyVotes('election-1');

    expect(result).toMatchObject({
      totalVotes: 1,
      turnout: 1,
      finalTallies: { yea: 1, nay: 0, abstain: 0 },
    });
    expect(legacyBallotWhere).not.toHaveBeenCalled();
    expect(aliveBallotWhere).toHaveBeenCalledTimes(1);
  });
});

describe('VoteService.tallyVotes status guard', () => {
  it('rejects tallying an election that is still voting_open', async () => {
    const electionLimit = vi.fn().mockResolvedValue([{
      id: 'election-1',
      method: 'yea_nay_abstain',
      status: 'voting_open',
      config: {},
    }]);
    const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
    const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });
    const select = vi.fn().mockReturnValue({ from: electionFrom });
    const update = vi.fn();
    const insert = vi.fn();
    const transaction = vi.fn();

    await expect(new VoteService({
      select,
      update,
      insert,
      transaction,
    } as any).tallyVotes('election-1'))
      .rejects.toThrow(/voting_closed/);

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

function makeCertifyDb(election: any, opts: { officeRow?: any; playerRow?: any; existingHolders?: any[] } = {}) {
  const officeRow = opts.officeRow ?? {
    id: 'office-1',
    name: 'Chancellor',
    isActive: true,
    maxHolders: 1,
    discordRoleId: null,
  };
  const playerRow = opts.playerRow ?? {
    id: 'winner-player',
    isAlive: true,
    characterName: 'Ada Vance',
    discordUsername: 'ada',
  };
  const existingHolders = opts.existingHolders ?? [];

  // Top-level db select: only used to fetch the election in certifyElection
  const electionLimit = vi.fn().mockResolvedValue(election ? [election] : []);
  const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
  const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });
  const topSelect = vi.fn().mockReturnValue({ from: electionFrom });

  // Inside the transaction, calls happen in order:
  //   1. update(elections).set().where().returning() -> certify row
  //   2. select(office).from(offices).where().limit()
  //   3. select(player).from(players).where().limit()
  //   4. select(existingHolding).from(officeHolders).where().limit()
  //   5. select(currentHolders).from(officeHolders).where()
  //   6. insert(officeHolders).values().returning() -> holder row
  //   7. insert(playerEventLog).values()
  const certifyReturning = vi.fn().mockResolvedValue([{ ...election, status: 'certified' }]);
  const certifyWhere = vi.fn().mockReturnValue({ returning: certifyReturning });
  const certifySet = vi.fn().mockReturnValue({ where: certifyWhere });
  const txUpdate = vi.fn().mockReturnValue({ set: certifySet });

  const officeLimit = vi.fn().mockResolvedValue([officeRow]);
  const officeWhere = vi.fn().mockReturnValue({ limit: officeLimit });
  const officeFrom = vi.fn().mockReturnValue({ where: officeWhere });

  const playerLimit = vi.fn().mockResolvedValue([playerRow]);
  const playerWhere = vi.fn().mockReturnValue({ limit: playerLimit });
  const playerFrom = vi.fn().mockReturnValue({ where: playerWhere });

  const existingHoldingLimit = vi.fn().mockResolvedValue([]);
  const existingHoldingWhere = vi.fn().mockReturnValue({ limit: existingHoldingLimit });
  const existingHoldingFrom = vi.fn().mockReturnValue({ where: existingHoldingWhere });

  const currentHoldersWhere = vi.fn().mockResolvedValue(existingHolders);
  const currentHoldersFrom = vi.fn().mockReturnValue({ where: currentHoldersWhere });

  const txSelect = vi.fn()
    .mockReturnValueOnce({ from: officeFrom })
    .mockReturnValueOnce({ from: playerFrom })
    .mockReturnValueOnce({ from: existingHoldingFrom })
    .mockReturnValueOnce({ from: currentHoldersFrom });

  const holderReturning = vi.fn().mockResolvedValue([{
    id: 'holder-1',
    officeId: 'office-1',
    playerId: 'winner-player',
    startDate: new Date('2026-05-13T00:00:00Z'),
    endDate: null,
    appointedBy: 'creator-player',
    appointmentMethod: 'appointed',
    electionId: null,
    removalReason: null,
    removedById: null,
    simTick: null,
    simDate: null,
  }]);
  const insertedHolders: any[] = [];
  const holderValues = vi.fn((value) => {
    insertedHolders.push(value);
    return { returning: holderReturning };
  });

  const insertedEvents: any[] = [];
  const eventValues = vi.fn((value) => {
    insertedEvents.push(value);
    return {};
  });

  const txInsert = vi.fn()
    .mockReturnValueOnce({ values: holderValues })
    .mockReturnValueOnce({ values: eventValues });

  const tx = { update: txUpdate, select: txSelect, insert: txInsert };
  const transaction = vi.fn(async (cb: any) => cb(tx));

  return {
    db: { select: topSelect, transaction },
    insertedHolders,
    insertedEvents,
    certifyReturning,
    transaction,
  };
}

describe('VoteService.certifyElection position auto-appointment', () => {
  it('appoints the winner to the office in a single transaction', async () => {
    const election = {
      id: 'election-1',
      type: 'position_election',
      status: 'tallied',
      forOfficeId: 'office-1',
      relatedBillId: null,
      createdById: 'creator-player',
      config: {},
      results: { winners: ['winner-player'], finalTallies: { 'winner-player': 5 } },
    };
    const { db, insertedHolders, insertedEvents, transaction } = makeCertifyDb(election);

    const updated = await new VoteService(db as any).certifyElection('election-1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({ id: 'election-1', status: 'certified' });
    expect(insertedHolders[0]).toMatchObject({
      officeId: 'office-1',
      playerId: 'winner-player',
      appointedBy: 'creator-player',
      appointmentMethod: 'appointed',
    });
    expect(insertedEvents[0]).toMatchObject({
      playerId: 'winner-player',
      eventType: 'office_appointed',
    });
  });

  it('refuses to certify a position election with no winner', async () => {
    const election = {
      id: 'election-1',
      type: 'position_election',
      status: 'tallied',
      forOfficeId: 'office-1',
      relatedBillId: null,
      createdById: 'creator-player',
      config: {},
      results: { winners: [], finalTallies: {} },
    };
    const { db, transaction } = makeCertifyDb(election);

    await expect(new VoteService(db as any).certifyElection('election-1')).rejects.toThrow(
      /no winner/i,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('VoteService.tallyVotes transactional safety', () => {
  it('rolls back the election status update if the bill_status_log insert fails', async () => {
    const castAt = new Date('2026-05-01T12:00:00.000Z');
    const yeaBallot = {
      id: 'ballot-yea',
      electionId: 'election-1',
      voterId: 'player-1',
      vote: { type: 'yea_nay_abstain', choice: 'yea' },
      castAt,
    };

    const electionLimit = vi.fn().mockResolvedValue([{
      id: 'election-1',
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
      createdById: 'creator-player',
      method: 'yea_nay_abstain',
      status: 'voting_closed',
      config: {},
    }]);
    const electionWhere = vi.fn().mockReturnValue({ limit: electionLimit });
    const electionFrom = vi.fn().mockReturnValue({ where: electionWhere });

    const aliveBallotWhere = vi.fn().mockResolvedValue([yeaBallot, yeaBallot]);
    const innerJoin = vi.fn().mockReturnValue({ where: aliveBallotWhere });
    const ballotFrom = vi.fn().mockReturnValue({ innerJoin });

    const clockLimit = vi.fn().mockResolvedValue([{ npcHouseActive: false }]);
    const clockFrom = vi.fn().mockReturnValue({ limit: clockLimit });

    // tx mock: update is fine, insert (status log) throws
    const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const txSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });

    const txInsertValues = vi.fn().mockRejectedValue(new Error('status log insert failed'));
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    const txSelect = vi.fn().mockReturnValue({ from: clockFrom });

    const tx = {
      select: txSelect,
      update: txUpdate,
      insert: txInsert,
    };

    const transaction = vi.fn(async (fn: (tx: any) => any) => fn(tx));

    const select = vi.fn()
      .mockReturnValueOnce({ from: electionFrom })
      .mockReturnValueOnce({ from: ballotFrom });

    const topLevelUpdate = vi.fn();
    const topLevelInsert = vi.fn();

    await expect(new VoteService({
      select,
      update: topLevelUpdate,
      insert: topLevelInsert,
      transaction,
    } as any).tallyVotes('election-1'))
      .rejects.toThrow('status log insert failed');

    // All writes should have gone through the transaction, not the bare db.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(topLevelUpdate).not.toHaveBeenCalled();
    expect(topLevelInsert).not.toHaveBeenCalled();
  });
});

describe('VoteService legislative bill status updates', () => {
  const castAt = new Date('2026-05-01T12:00:00.000Z');
  const yeaBallot = {
    id: 'ballot-yea',
    electionId: 'election-1',
    voterId: 'player-1',
    vote: { type: 'yea_nay_abstain', choice: 'yea' },
    castAt,
  };
  const nayBallot = {
    id: 'ballot-nay',
    electionId: 'election-1',
    voterId: 'player-2',
    vote: { type: 'yea_nay_abstain', choice: 'nay' },
    castAt,
  };

  it('marks a linked bill player-passed when the NPC house is inactive', async () => {
    const { db, updateValues, statusLogValues } = makeLegislativeTallyDb({
      npcHouseActive: false,
      aliveBallotRows: [yeaBallot, yeaBallot, nayBallot],
      election: {
        id: 'election-1',
        type: 'legislative_vote',
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
        method: 'yea_nay_abstain',
        status: 'voting_closed',
        config: {},
      },
    });

    await new VoteService(db as any).tallyVotes('election-1');

    expect(updateValues[1]).toMatchObject({
      status: 'player_passed',
      playerVoteResult: 'passed',
      npcVoteRequired: false,
    });
    expect(updateValues[1]).toHaveProperty('playerVoteAt');
    expect(statusLogValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: 'voting',
      toStatus: 'player_passed',
      changedById: 'creator-player',
    });
  });

  it('marks a linked bill NPC-pending when the NPC house is active', async () => {
    const { db, updateValues, statusLogValues } = makeLegislativeTallyDb({
      npcHouseActive: true,
      aliveBallotRows: [yeaBallot, yeaBallot, nayBallot],
      election: {
        id: 'election-1',
        type: 'legislative_vote',
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
        method: 'yea_nay_abstain',
        status: 'voting_closed',
        config: {},
      },
    });

    await new VoteService(db as any).tallyVotes('election-1');

    expect(updateValues[1]).toMatchObject({
      status: 'npc_pending',
      playerVoteResult: 'passed',
      npcVoteRequired: true,
      npcVote: { status: 'pending' },
    });
    expect(statusLogValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: 'voting',
      toStatus: 'npc_pending',
      changedById: 'creator-player',
    });
  });
});
