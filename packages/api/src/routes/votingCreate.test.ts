import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import votingRoutes from './voting';

const mocks = vi.hoisted(() => ({
  aggregatePermissionsForPlayer: vi.fn(),
  createElection: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'player-1' } };
    request.player = { id: 'player-1', isStaff: false };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../services/playerService.js', () => ({
  aggregatePermissionsForPlayer: mocks.aggregatePermissionsForPlayer,
}));

vi.mock('../services/voteService.js', () => ({
  VoteService: class {
    createElection = mocks.createElection;
  },
}));

async function appWithVotingRoutes() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(votingRoutes);
  return app;
}

describe('POST /api/elections type gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregatePermissionsForPlayer.mockResolvedValue([]);
    mocks.createElection.mockResolvedValue({ id: 'election-1', status: 'draft' });
  });

  it.each(['constitutional_amendment', 'general_election'])(
    'refuses a %s from a player without the required office permission',
    async (type) => {
      const app = await appWithVotingRoutes();

      const res = await app.inject({
        method: 'POST',
        url: '/api/elections',
        payload: { title: 'Amend the charter', type, method: 'yea_nay_abstain' },
      });

      expect(res.statusCode).toBe(403);
      expect(mocks.createElection).not.toHaveBeenCalled();
    },
  );

  it('still lets any player create a referendum', async () => {
    const app = await appWithVotingRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/elections',
      payload: { title: 'Bridge tolls?', type: 'referendum', method: 'yea_nay_abstain' },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.createElection).toHaveBeenCalledTimes(1);
  });
});
