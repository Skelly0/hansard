import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import officeRoutes from './offices';

const auth = vi.hoisted(() => ({
  isStaff: false,
}));

const mocks = vi.hoisted(() => ({
  listOffices: vi.fn(),
  getOffice: vi.fn(),
  appointToOffice: vi.fn(),
  removeFromOffice: vi.fn(),
}));

const observedStaffActionMarkers: unknown[] = [];

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'viewer-player' } };
    request.player = { id: 'viewer-player', isStaff: auth.isStaff };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../middleware/requireRole.js', () => ({
  requireRole: () => async () => {},
}));

vi.mock('../services/officeService.js', () => ({
  listOffices: mocks.listOffices,
  getOffice: mocks.getOffice,
  createOffice: vi.fn(),
  updateOffice: vi.fn(),
  appointToOffice: mocks.appointToOffice,
  removeFromOffice: mocks.removeFromOffice,
}));

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  app.addHook('onResponse', async (request) => {
    observedStaffActionMarkers.push(request.staffActionLog);
  });
  await app.register(officeRoutes);
  return app;
}

const office = {
  id: 'office-1',
  name: 'Chancellor',
  tier: 'legislature',
  factionId: null,
  maxHolders: 1,
  permissions: ['legislative_leader', 'call_elections'],
  filledBy: 'elected',
  appointableBy: null,
  requiresConfirmation: false,
  discordRoleId: '1234567890',
  isActive: true,
  sortOrder: 1,
  currentHolders: [],
};

describe('office routes', () => {
  beforeEach(() => {
    auth.isStaff = false;
    vi.clearAllMocks();
    mocks.listOffices.mockResolvedValue([office]);
    mocks.getOffice.mockResolvedValue({ ...office, holderHistory: [] });
    mocks.appointToOffice.mockResolvedValue({ id: 'holder-1' });
    mocks.removeFromOffice.mockResolvedValue({ removed: true });
    observedStaffActionMarkers.length = 0;
  });

  it('omits office permission strings for non-staff players', async () => {
    const app = await appWithRoutes();

    const [listRes, detailRes] = await Promise.all([
      app.inject('/api/offices'),
      app.inject('/api/offices/office-1'),
    ]);

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()[0]).not.toHaveProperty('permissions');
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json()).not.toHaveProperty('permissions');
  });

  it('keeps office permission strings for staff players', async () => {
    auth.isStaff = true;
    const app = await appWithRoutes();

    const res = await app.inject('/api/offices');

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].permissions).toEqual(['legislative_leader', 'call_elections']);
  });

  it('marks office appointments by non-staff office holders for mod logging', async () => {
    const app = await appWithRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/offices/office-1/appoint',
      payload: { playerId: 'target-player' },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.appointToOffice).toHaveBeenCalled();
    // The route is authorized by requireRole in this test, but auth.isStaff is false.
    // It still needs the marker so the app-level mod-log hook will post it.
    expect(observedStaffActionMarkers.at(-1)).toBe(true);
  });

  it('marks office removals by non-staff office holders for mod logging', async () => {
    const app = await appWithRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/offices/office-1/remove',
      payload: { reason: 'reshuffle' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.removeFromOffice).toHaveBeenCalled();
    expect(observedStaffActionMarkers.at(-1)).toBe(true);
  });
});
