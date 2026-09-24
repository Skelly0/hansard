import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import billRoutes from './bills';

const mocks = vi.hoisted(() => ({
  submitBill: vi.fn(),
  submitBillFor: vi.fn(),
  author: [] as unknown[],
  isStaff: false,
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'session-player' } };
    request.player = { id: 'session-player', isStaff: mocks.isStaff };
  },
}));
vi.mock('../middleware/requireStaff.js', () => ({ requireStaff: async () => {} }));
vi.mock('../middleware/requireRole.js', () => ({ requireRole: () => async () => {} }));

vi.mock('../services/billService.js', () => ({
  submitBill: mocks.submitBill,
  submitBillFor: mocks.submitBillFor,
  getBill: vi.fn(),
  getBillByNumber: vi.fn(),
  listBills: vi.fn(),
  searchBills: vi.fn(),
  updateBill: vi.fn(),
  updateEffects: vi.fn(),
  createVoteOnBill: vi.fn(),
  enterNpcVote: vi.fn(),
  enactBill: vi.fn(),
  repealBill: vi.fn(),
  getBillStatusLog: vi.fn(),
  getVoters: vi.fn(),
}));

vi.mock('../services/playerService.js', () => ({
  aggregatePermissionsForPlayer: vi.fn().mockResolvedValue([]),
}));

function fakeDb() {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(mocks.author),
  };
  return { select: () => chain };
}

async function app() {
  const instance = Fastify({ logger: false });
  instance.decorate('db', fakeDb() as any);
  await instance.register(billRoutes);
  return instance;
}

const shortBill = { title: 'Expenses Bill', billType: 'short', content: '1. Publish expenses.' };

describe('POST /api/bills author guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff = false;
    mocks.submitBill.mockResolvedValue({ id: 'b1', slug: 'expenses-bill' });
  });

  it('refuses a login-only account with no character', async () => {
    mocks.author = [{ characterName: null, isAlive: true }];
    const res = await (await app()).inject({ method: 'POST', url: '/api/bills', payload: shortBill });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/character/i);
    expect(mocks.submitBill).not.toHaveBeenCalled();
  });

  it('refuses a deceased character', async () => {
    mocks.author = [{ characterName: 'Reginald Fairfax', isAlive: false }];
    const res = await (await app()).inject({ method: 'POST', url: '/api/bills', payload: shortBill });
    expect(res.statusCode).toBe(400);
    expect(mocks.submitBill).not.toHaveBeenCalled();
  });

  it('submits for a living character', async () => {
    mocks.author = [{ characterName: 'Ada Quenby', isAlive: true }];
    const res = await (await app()).inject({ method: 'POST', url: '/api/bills', payload: shortBill });
    expect(res.statusCode).toBe(201);
    expect(mocks.submitBill).toHaveBeenCalledWith(expect.anything(), 'session-player', expect.objectContaining({
      title: 'Expenses Bill',
      billType: 'short',
    }));
  });

  it('checks the on-behalf author, not the submitter', async () => {
    mocks.isStaff = true;
    mocks.author = [{ characterName: null, isAlive: true }];
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/bills',
      payload: { ...shortBill, authorId: 'other-player' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('The chosen author has no character');
    expect(mocks.submitBillFor).not.toHaveBeenCalled();
  });
});
