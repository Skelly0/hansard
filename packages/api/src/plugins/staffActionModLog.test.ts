import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import staffActionModLogPlugin from './staffActionModLog.js';

const mocks = vi.hoisted(() => ({
  postApiStaffActionLog: vi.fn(),
}));

vi.mock('../services/modLogService.js', () => ({
  postApiStaffActionLog: mocks.postApiStaffActionLog,
}));

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(staffActionModLogPlugin);

  app.post('/api/staff-test', async (request) => {
    request.player = {
      id: 'staff-player',
      discordId: 'discord-staff',
      discordUsername: 'Skell',
      characterName: 'Minister Prime',
      isStaff: true,
    } as any;
    request.staffActionLog = true;
    return { ok: true };
  });

  app.post('/api/staff-fail', async (request, reply) => {
    request.player = {
      id: 'staff-player',
      discordId: 'discord-staff',
      discordUsername: 'Skell',
      characterName: 'Minister Prime',
      isStaff: true,
    } as any;
    request.staffActionLog = true;
    return reply.code(400).send({ error: 'bad' });
  });

  app.get('/api/staff-test', async (request) => {
    request.player = {
      id: 'staff-player',
      discordId: 'discord-staff',
      discordUsername: 'Skell',
      characterName: 'Minister Prime',
      isStaff: true,
    } as any;
    request.staffActionLog = true;
    return { ok: true };
  });

  app.post('/api/staff-unmarked', async (request) => {
    request.player = {
      id: 'staff-player',
      discordId: 'discord-staff',
      discordUsername: 'Skell',
      characterName: 'Minister Prime',
      isStaff: true,
    } as any;
    return { ok: true };
  });

  return app;
}

describe('staffActionModLogPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs successful mutating staff actions after the response completes', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/staff-test',
      payload: { amount: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.postApiStaffActionLog).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ id: 'staff-player', discordId: 'discord-staff' }),
      method: 'POST',
      path: '/api/staff-test',
      statusCode: 200,
      payload: { amount: 5 },
    }));
  });

  it('does not log failed or read-only requests', async () => {
    const app = await buildTestApp();

    await app.inject({
      method: 'POST',
      url: '/api/staff-fail',
      payload: { amount: 5 },
    });
    await app.inject({
      method: 'GET',
      url: '/api/staff-test',
    });

    expect(mocks.postApiStaffActionLog).not.toHaveBeenCalled();
  });

  it('does not log ordinary writes by staff users unless the route marks them as staff actions', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/staff-unmarked',
      payload: { vote: 'private choice' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.postApiStaffActionLog).not.toHaveBeenCalled();
  });
});
