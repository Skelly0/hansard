import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { name: 'db' },
  closeDb: vi.fn(),
  closeDueVotes: vi.fn(),
  listDueOpenVotes: vi.fn(),
  voteService: {
    tallyVotes: vi.fn(),
  },
  client: {
    once: vi.fn(),
    login: vi.fn(),
    destroy: vi.fn(),
  },
  autoEnactPassedBillFromElection: vi.fn(),
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

vi.mock('discord.js', () => ({
  Events: { ClientReady: 'ready' },
}));

vi.mock('../client.js', () => ({
  client: mocks.client,
}));

vi.mock('../commands/bills/autoEnact.js', () => ({
  autoEnactPassedBillFromElection: mocks.autoEnactPassedBillFromElection,
}));

describe('closeDueVotes script runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    mocks.closeDueVotes.mockResolvedValue({
      closed: [],
      failed: [],
      renderFailed: [],
    });
    mocks.voteService.tallyVotes.mockResolvedValue({});
    mocks.client.once.mockImplementation((_event, handler) => {
      handler();
      return mocks.client;
    });
    mocks.client.login.mockResolvedValue('token');
    mocks.client.destroy.mockReturnValue(undefined);
    mocks.autoEnactPassedBillFromElection.mockResolvedValue({ status: 'enacted' });
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
    const election = { id: 'election-1', type: 'legislative_vote', relatedBillId: 'bill-1' };
    await options.tallyElection(election);

    expect(mocks.VoteServiceCtor).toHaveBeenCalledWith(mocks.db);
    expect(mocks.voteService.tallyVotes).toHaveBeenCalledWith('election-1');
    expect(mocks.autoEnactPassedBillFromElection).toHaveBeenCalledWith({
      database: mocks.db,
      client: mocks.client,
      election,
    });
    expect(mocks.client.login).toHaveBeenCalledWith('test-token');
    expect(mocks.client.destroy).toHaveBeenCalled();
    expect(mocks.closeDb).toHaveBeenCalledWith(mocks.db);
  });
});
