import { describe, expect, it, vi } from 'vitest';
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

  const select = vi.fn()
    .mockReturnValueOnce({ from: electionFrom })
    .mockReturnValueOnce({ from: ballotFrom });

  return {
    db: { select, update },
    legacyBallotWhere,
    aliveBallotWhere,
    innerJoin,
    update,
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
