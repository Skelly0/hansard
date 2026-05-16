import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { name: 'db' },
  closeDb: vi.fn(),
  closeDueVotes: vi.fn(),
  listDueOpenVotes: vi.fn(),
  voteService: {
    tallyVotes: vi.fn(),
  },
  VoteServiceCtor: vi.fn(),
  VoteService: vi.fn(),
}));

vi.mock('@hansard/db', () => ({
  closeDb: mocks.closeDb,
}));

vi.mock('../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../services/voteAutoClose.js', () => ({
  closeDueVotes: mocks.closeDueVotes,
  listDueOpenVotes: mocks.listDueOpenVotes,
}));

vi.mock('@hansard/api/services/voteService', () => ({
  VoteService: mocks.VoteService,
}));

describe('closeDueVotes script runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.closeDueVotes.mockResolvedValue({
      closed: [],
      failed: [],
      renderFailed: [],
    });
    mocks.voteService.tallyVotes.mockResolvedValue({});
    mocks.VoteService.mockImplementation(class {
      constructor(database: unknown) {
        mocks.VoteServiceCtor(database);
        return mocks.voteService;
      }
    } as any);
  });

  it('wires catch-up runs to auto-tally linked legislative votes', async () => {
    const { runCloseDueVotesScript } = await import('./closeDueVotes');
    const logger = { log: vi.fn(), error: vi.fn() };

    await runCloseDueVotesScript({ args: [], logger });

    expect(mocks.closeDueVotes).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        logger,
        tallyElection: expect.any(Function),
      }),
    );

    const options = mocks.closeDueVotes.mock.calls[0]?.[1];
    await options.tallyElection({ id: 'election-1' });

    expect(mocks.VoteServiceCtor).toHaveBeenCalledWith(mocks.db);
    expect(mocks.voteService.tallyVotes).toHaveBeenCalledWith('election-1');
    expect(mocks.closeDb).toHaveBeenCalledWith(mocks.db);
  });
});
