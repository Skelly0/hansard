import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import officeRoutes from './offices';

const auth = vi.hoisted(() => ({
  isStaff: false,
}));

const mocks = vi.hoisted(() => ({
  listOffices: vi.fn(),
  getOffice: vi.fn(),
}));

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
  appointToOffice: vi.fn(),
  removeFromOffice: vi.fn(),
}));

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
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
});
