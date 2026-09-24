import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import playerRoutes from './players';

const mocks = vi.hoisted(() => ({ updateCharacter: vi.fn() }));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'player-1' } };
    request.player = { id: 'player-1', isStaff: false };
  },
}));
vi.mock('../middleware/requireStaff.js', () => ({ requireStaff: async () => {} }));
vi.mock('../services/playerService.js', () => ({
  createCharacter: vi.fn(),
  getPlayer: vi.fn(),
  getPlayerByDiscordId: vi.fn(),
  listPlayers: vi.fn(),
  countPlayers: vi.fn(),
  updateCharacter: mocks.updateCharacter,
  changeParty: vi.fn(),
  leaveParty: vi.fn(),
  getPlayerEvents: vi.fn(),
  getPlayerHealth: vi.fn(),
  getPlayerOfficeHistory: vi.fn(),
  getPlayerVotingRecord: vi.fn(),
  sanitizePlayerProfile: vi.fn((p) => p),
  attachPlayerAffiliations: vi.fn(async (_db, p) => p),
  attachEventActors: vi.fn(async (_db, e) => e),
  calculateStartingAgeFavourBonus: vi.fn(),
}));
vi.mock('../services/billService.js', () => ({ listBills: vi.fn() }));
vi.mock('../services/favourService.js', () => ({ getHistory: vi.fn(), getPlayerBalances: vi.fn() }));
vi.mock('../services/ticketService.js', () => ({ TicketService: class {} }));

async function patch(payload: unknown, id = 'player-1') {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(playerRoutes);
  return app.inject({ method: 'PATCH', url: `/api/players/${id}`, payload: payload as any });
}

describe('PATCH /api/players/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCharacter.mockResolvedValue({ id: 'player-1', characterName: 'Ada' });
  });

  it('rejects non-http portrait URLs', async () => {
    const res = await patch({ characterPortraitUrl: 'javascript:alert(1)' });
    expect(res.statusCode).toBe(400);
    expect(mocks.updateCharacter).not.toHaveBeenCalled();
  });

  it('rejects a bio longer than the Discord modal allows', async () => {
    const res = await patch({ characterBio: 'x'.repeat(2001) });
    expect(res.statusCode).toBe(400);
  });

  it('accepts an https portrait and an empty bio', async () => {
    const res = await patch({ characterPortraitUrl: 'https://example.org/ada.png', characterBio: '' });
    expect(res.statusCode).toBe(200);
    expect(mocks.updateCharacter).toHaveBeenCalledWith(expect.anything(), 'player-1', {
      characterPortraitUrl: 'https://example.org/ada.png',
      characterBio: '',
    });
  });

  it('allows clearing the portrait with an empty string', async () => {
    const res = await patch({ characterPortraitUrl: '' });
    expect(res.statusCode).toBe(200);
  });

  it('translates a duplicate character name into 409', async () => {
    mocks.updateCharacter.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'players_character_name_unique',
    }));
    const res = await patch({ characterName: 'Eleanor Ashcombe' });
    expect(res.statusCode).toBe(409);
  });

  it('still refuses to edit someone else', async () => {
    const res = await patch({ characterBio: 'hi' }, 'player-2');
    expect(res.statusCode).toBe(403);
  });
});
