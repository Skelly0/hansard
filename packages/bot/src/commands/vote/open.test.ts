import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    update: vi.fn(),
  },
  findElectionByReference: vi.fn(),
  hasPermission: vi.fn(),
  wakeVoteAutoCloseWorker: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  elections: {
    id: 'elections.id',
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

vi.mock('../../services/voteAutoClose.js', () => ({
  wakeVoteAutoCloseWorker: mocks.wakeVoteAutoCloseWorker,
}));

import { execute } from './open';

function makeInteraction() {
  return {
    member: { roles: {} },
    options: {
      getString: vi.fn(() => 'budget vote'),
    },
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
}

describe('/vote open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.findElectionByReference.mockResolvedValue({
      election: {
        id: 'election-1',
        status: 'draft',
      },
    });
    mocks.db.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{
            id: 'election-1',
            title: 'Budget Vote',
            method: 'yea_nay_abstain',
            votingClosesAt: new Date('2026-01-02T00:00:00.000Z'),
            useReactions: false,
          }]),
        })),
      })),
    });
  });

  it('wakes the auto-close worker after opening voting', async () => {
    await execute(makeInteraction() as any);

    expect(mocks.wakeVoteAutoCloseWorker).toHaveBeenCalledWith('vote-opened');
  });
});
