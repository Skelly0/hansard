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

const validNpcElection = {
  id: 'election-1',
  title: 'Minister Appointment',
  type: 'appointment_confirmation',
  status: 'npc_pending',
  config: { requiresNpcConfirmation: true },
};

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
