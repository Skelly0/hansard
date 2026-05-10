import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import simulationRoutes from './simulation';

const mocks = vi.hoisted(() => ({
  advanceTime: vi.fn(),
  previewAdvance: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'staff-player' } };
    request.player = { id: 'staff-player', isStaff: true };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async () => {},
}));

vi.mock('../services/simulationService.js', () => ({
  getClock: vi.fn(),
  advanceTime: mocks.advanceTime,
  previewAdvance: mocks.previewAdvance,
  getHistory: vi.fn(),
  manualAilment: vi.fn(),
  manualDeath: vi.fn(),
  heal: vi.fn(),
}));

async function appWithSimulationRoutes() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(simulationRoutes);
  return app;
}

describe('simulation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.advanceTime.mockResolvedValue({ ok: true });
    mocks.previewAdvance.mockResolvedValue({ ok: true });
  });

  it('rejects non-numeric advance ticks before calling the service', async () => {
    const app = await appWithSimulationRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulation/advance',
      payload: { ticks: '2' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Ticks must be an integer between 1 and 100' });
    expect(mocks.advanceTime).not.toHaveBeenCalled();
  });

  it('passes validated integer ticks to advanceTime', async () => {
    const app = await appWithSimulationRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulation/advance',
      payload: { ticks: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.advanceTime).toHaveBeenCalledWith(expect.anything(), 2, 'staff-player');
  });

  it('defaults missing advance body to one tick', async () => {
    const app = await appWithSimulationRoutes();

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulation/advance',
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.advanceTime).toHaveBeenCalledWith(expect.anything(), 1, 'staff-player');
  });
});
