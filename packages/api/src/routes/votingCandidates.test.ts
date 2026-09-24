import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import votingRoutes from './voting';

const mocks = vi.hoisted(() => ({
  isStaff: false,
  getElection: vi.fn(),
  registerCandidate: vi.fn(),
  withdrawCandidate: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'player-1' } };
    request.player = { id: 'player-1', isStaff: mocks.isStaff, partyId: 'own-party' };
  },
}));
vi.mock('../middleware/requireStaff.js', () => ({ requireStaff: async () => {} }));
vi.mock('../services/playerService.js', () => ({ aggregatePermissionsForPlayer: vi.fn() }));
vi.mock('../services/voteService.js', () => ({
  VoteService: class {
    getElection = mocks.getElection;
    registerCandidate = mocks.registerCandidate;
    withdrawCandidate = mocks.withdrawCandidate;
  },
}));

async function app() {
  const instance = Fastify({ logger: false });
  instance.decorate('db', {} as any);
  await instance.register(votingRoutes);
  return instance;
}

describe('POST /api/elections/:id/candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff = false;
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'nominations_open', createdById: 'someone' });
    mocks.registerCandidate.mockResolvedValue({ id: 'c1' });
  });

  it('registers a player under their own party, ignoring a claimed banner', async () => {
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/elections/e1/candidates',
      payload: { statement: 'Vote for me', partyId: 'rival-party' },
    });
    expect(res.statusCode).toBe(201);
    expect(mocks.registerCandidate).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      partyId: 'own-party',
      statement: 'Vote for me',
      nominatedById: 'player-1',
    }));
  });

  it('lets staff set the party when nominating', async () => {
    mocks.isStaff = true;
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/elections/e1/candidates',
      payload: { playerId: 'player-2', partyId: 'their-party' },
    });
    expect(res.statusCode).toBe(201);
    expect(mocks.registerCandidate).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      partyId: 'their-party',
    }));
  });

  it('trims the statement and rejects an over-long one', async () => {
    const ok = await (await app()).inject({
      method: 'POST',
      url: '/api/elections/e1/candidates',
      payload: { statement: '  For the commons  ' },
    });
    expect(ok.statusCode).toBe(201);
    expect(mocks.registerCandidate).toHaveBeenCalledWith(expect.objectContaining({ statement: 'For the commons' }));

    const long = await (await app()).inject({
      method: 'POST',
      url: '/api/elections/e1/candidates',
      payload: { statement: 'x'.repeat(1001) },
    });
    expect(long.statusCode).toBe(400);
    expect(mocks.registerCandidate).toHaveBeenCalledTimes(1);
  });

  it('refuses to let a player nominate someone else', async () => {
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/elections/e1/candidates',
      payload: { playerId: 'player-2' },
    });
    expect(res.statusCode).toBe(403);
    expect(mocks.registerCandidate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/elections/:id/candidates/:playerId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff = false;
    mocks.withdrawCandidate.mockResolvedValue({ id: 'c1', isWithdrawn: true });
  });

  const withdraw = async (playerId: string) =>
    (await app()).inject({ method: 'DELETE', url: `/api/elections/e1/candidates/${playerId}` });

  it('lets a candidate drop out while voting is open', async () => {
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'voting_open', createdById: 'someone' });
    const res = await withdraw('player-1');
    expect(res.statusCode).toBe(200);
    expect(mocks.withdrawCandidate).toHaveBeenCalledWith('e1', 'player-1');
  });

  it('stops a non-staff creator striking a rival off mid-ballot', async () => {
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'voting_open', createdById: 'player-1' });
    const res = await withdraw('player-2');
    expect(res.statusCode).toBe(403);
    expect(mocks.withdrawCandidate).not.toHaveBeenCalled();
  });

  it('still lets a creator tidy the list before voting opens', async () => {
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'nominations_open', createdById: 'player-1' });
    const res = await withdraw('player-2');
    expect(res.statusCode).toBe(200);
  });

  it('locks the list for non-staff once voting has closed', async () => {
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'tallied', createdById: 'someone' });
    const res = await withdraw('player-1');
    expect(res.statusCode).toBe(409);
    expect(mocks.withdrawCandidate).not.toHaveBeenCalled();
  });

  it('leaves staff able to correct a closed list', async () => {
    mocks.isStaff = true;
    mocks.getElection.mockResolvedValue({ id: 'e1', status: 'tallied', createdById: 'someone' });
    const res = await withdraw('player-2');
    expect(res.statusCode).toBe(200);
  });
});
