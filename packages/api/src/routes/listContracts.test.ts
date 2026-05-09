import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import billRoutes from './bills';
import documentRoutes from './documents';
import moderationRoutes from './moderation';
import playerRoutes from './players';
import ticketRoutes from './tickets';

const mocks = vi.hoisted(() => ({
  listBills: vi.fn(),
  listDocuments: vi.fn(),
  getPlayer: vi.fn(),
  getPlayerEvents: vi.fn(),
  getPlayerOfficeHistory: vi.fn(),
  getPlayerVotingRecord: vi.fn(),
  listPlayers: vi.fn(),
  countPlayers: vi.fn(),
  getPlayerBalances: vi.fn(),
  getFavourHistory: vi.fn(),
  listActions: vi.fn(),
  countActions: vi.fn(),
  listTickets: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'session-player' } };
    request.player = { id: 'session-player', isStaff: true };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../middleware/requireRole.js', () => ({
  requireRole: () => async () => {},
}));

vi.mock('../services/billService.js', () => ({
  submitBill: vi.fn(),
  submitBillFor: vi.fn(),
  getBill: vi.fn(),
  getBillByNumber: vi.fn(),
  listBills: mocks.listBills,
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

vi.mock('../services/documentService.js', () => ({
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: mocks.listDocuments,
  updateDocument: vi.fn(),
  getVersionHistory: vi.fn(),
  searchDocuments: vi.fn(),
  getCollections: vi.fn(),
  rollbackDocument: vi.fn(),
}));

vi.mock('../services/playerService.js', () => ({
  createCharacter: vi.fn(),
  getPlayer: mocks.getPlayer,
  getPlayerByDiscordId: vi.fn(),
  listPlayers: mocks.listPlayers,
  countPlayers: mocks.countPlayers,
  updateCharacter: vi.fn(),
  changeParty: vi.fn(),
  leaveParty: vi.fn(),
  getPlayerEvents: mocks.getPlayerEvents,
  getPlayerHealth: vi.fn(),
  getPlayerOfficeHistory: mocks.getPlayerOfficeHistory,
  getPlayerVotingRecord: mocks.getPlayerVotingRecord,
  calculateStartingAgeFavourBonus: vi.fn(),
  aggregatePermissionsForPlayer: vi.fn(),
}));

vi.mock('../services/favourService.js', () => ({
  getPlayerBalances: mocks.getPlayerBalances,
  getHistory: mocks.getFavourHistory,
}));

vi.mock('../services/ticketService.js', () => ({
  TicketService: class {
    listTickets = mocks.listTickets;
    getCategories = vi.fn();
    getMetrics = vi.fn();
    getTicketsByIds = vi.fn();
    getTicket = vi.fn();
    createTicket = vi.fn();
    updateTicket = vi.fn();
    addMessage = vi.fn();
    assignTicket = vi.fn();
    closeTicket = vi.fn();
    linkTickets = vi.fn();
    unlinkTickets = vi.fn();
    createOrUpdateCategory = vi.fn();
  },
}));

vi.mock('../services/modService.js', () => ({
  createAction: vi.fn(),
  updateAction: vi.fn(),
  addNote: vi.fn(),
  getPlayerModHistory: vi.fn(),
  listActions: mocks.listActions,
  countActions: mocks.countActions,
  getStats: vi.fn(),
}));

async function appWith(register: (app: any) => Promise<void> | void) {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(register);
  return app;
}

describe('list route response contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBills.mockResolvedValue({ bills: [{ id: 'b1' }], total: 1 });
    mocks.listDocuments.mockResolvedValue({ documents: [{ id: 'd1' }], total: 1 });
    mocks.getPlayer.mockResolvedValue({ id: 'p1', characterName: 'Ada' });
    mocks.getPlayerEvents.mockResolvedValue([{ id: 'e1' }]);
    mocks.getPlayerOfficeHistory.mockResolvedValue([{ officeId: 'o1', officeName: 'Chancellor' }]);
    mocks.getPlayerVotingRecord.mockResolvedValue([{ electionId: 'v1', electionTitle: 'Vote', choice: 'yea' }]);
    mocks.listPlayers.mockResolvedValue([{ id: 'p1' }]);
    mocks.countPlayers.mockResolvedValue(1);
    mocks.getPlayerBalances.mockResolvedValue([{ categoryId: 'f1', categoryName: 'Guild', balance: 7 }]);
    mocks.getFavourHistory.mockResolvedValue([{ id: 'ft1' }]);
    mocks.listActions.mockResolvedValue([{ id: 'm1' }]);
    mocks.countActions.mockResolvedValue(1);
    mocks.listTickets.mockResolvedValue({ tickets: [{ id: 't1' }], total: 1 });
  });

  it('returns bills as { data, total } and passes list query filters through', async () => {
    const app = await appWith(billRoutes);
    const res = await app.inject('/api/bills?authorId=p1&search=tax&sort=title&limit=20&offset=40');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'b1' }], total: 1 });
    expect(mocks.listBills).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authorId: 'p1',
      search: 'tax',
      sort: 'title',
      limit: 20,
      offset: 40,
    }));
  });

  it('returns documents as { data, total } and passes list query filters through', async () => {
    const app = await appWith(documentRoutes);
    const res = await app.inject('/api/documents?collectionId=c1&authorId=p1&search=charter&limit=10&offset=30');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'd1' }], total: 1 });
    expect(mocks.listDocuments).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      collectionId: 'c1',
      authorId: 'p1',
      search: 'charter',
      limit: 10,
      offset: 30,
    }));
  });

  it('returns tickets as { data, total }', async () => {
    const app = await appWith(ticketRoutes);
    const res = await app.inject('/api/tickets?categoryId=c1&assignedToId=p1&limit=20&offset=40');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 't1' }], total: 1 });
  });

  it('returns players as { data, total }', async () => {
    const app = await appWith(playerRoutes);
    const res = await app.inject('/api/players?partyId=party-1&isAlive=false&limit=24&offset=24');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'p1' }], total: 1 });
  });

  it('returns a player dossier with related records instead of empty stubs', async () => {
    const app = await appWith(playerRoutes);
    const res = await app.inject('/api/players/p1');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: 'p1',
      offices: [{ officeId: 'o1', officeName: 'Chancellor' }],
      bills: [{ id: 'b1' }],
      votes: [{ electionId: 'v1', electionTitle: 'Vote', choice: 'yea' }],
      favours: [{ categoryId: 'f1', categoryName: 'Guild', balance: 7 }],
      events: [{ id: 'e1' }],
    });
    expect(mocks.listBills).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authorId: 'p1',
      limit: 100,
    }));
  });

  it('returns player subresources in the shapes consumed by the web hooks', async () => {
    const app = await appWith(playerRoutes);

    const [bills, votes, offices, tickets, favours] = await Promise.all([
      app.inject('/api/players/p1/bills'),
      app.inject('/api/players/p1/votes'),
      app.inject('/api/players/p1/offices'),
      app.inject('/api/players/p1/tickets'),
      app.inject('/api/players/p1/favours'),
    ]);

    expect(bills.json()).toEqual([{ id: 'b1' }]);
    expect(votes.json()).toEqual([{ electionId: 'v1', electionTitle: 'Vote', choice: 'yea' }]);
    expect(offices.json()).toEqual([{ officeId: 'o1', officeName: 'Chancellor' }]);
    expect(tickets.json()).toEqual({ data: [{ id: 't1' }], total: 1 });
    expect(favours.json()).toEqual({
      playerId: 'p1',
      balances: [{ categoryId: 'f1', categoryName: 'Guild', balance: 7 }],
      transactions: [{ id: 'ft1' }],
    });
  });

  it('returns moderation actions as { data, total }', async () => {
    const app = await appWith(moderationRoutes);
    const res = await app.inject('/api/moderation/actions?targetPlayerId=p1&limit=20&offset=40');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'm1' }], total: 1 });
    expect(mocks.listActions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      targetPlayerId: 'p1',
      limit: 20,
      offset: 40,
    }));
  });
});
