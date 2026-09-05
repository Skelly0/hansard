import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../types.js';

const mocks = vi.hoisted(() => ({
  findOrCreatePlayerByDiscordId: vi.fn(),
  aggregatePermissionsForPlayer: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../services/playerService.js', () => ({
  findOrCreatePlayerByDiscordId: mocks.findOrCreatePlayerByDiscordId,
  aggregatePermissionsForPlayer: mocks.aggregatePermissionsForPlayer,
}));

import authPlugin from './auth.js';

const PLAYER = {
  id: 'player-1',
  discordId: 'discord-1',
  discordUsername: 'ada',
  isStaff: false,
  staffRole: null,
};

function dbReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('db', dbReturning([PLAYER]) as any);
  await app.register(cookie);
  await app.register(session, {
    secret: 'test-session-secret-that-is-at-least-32-chars-long',
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
    saveUninitialized: false,
  });
  await app.register(authPlugin);
  await app.ready();
  return app;
}

/** Extract the raw session cookie ("sessionId=...") from a response. */
function sessionCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const hit = list.find((c) => c.startsWith('sessionId='));
  return hit?.split(';')[0];
}

/** The unsigned session id portion of a "sessionId=<sid>.<sig>" cookie. */
function sessionIdOf(cookieHeader: string): string {
  const value = decodeURIComponent(cookieHeader.slice('sessionId='.length));
  return value.split('.')[0];
}

function stateOf(location: string): string | null {
  return new URL(location).searchParams.get('state');
}

function mockDiscordExchangeSuccess() {
  mocks.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', token_type: 'Bearer' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'discord-1', username: 'ada', avatar: null }),
    });
}

describe('Discord OAuth login flow', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.findOrCreatePlayerByDiscordId.mockResolvedValue({ player: PLAYER, created: false });
    mocks.aggregatePermissionsForPlayer.mockResolvedValue([]);
    app = await buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it('sends a per-session state parameter to Discord', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/discord' });

    expect(res.statusCode).toBe(302);
    const state = stateOf(res.headers.location as string);
    expect(state).not.toBeNull();
    expect(state).toMatch(/^[a-f0-9]{32,}$/);
    // The state has to be remembered somewhere the callback can check it.
    expect(sessionCookie(res)).toBeDefined();
  });

  it('rejects a callback whose state does not match the session', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const cookie = sessionCookie(start)!;

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/discord/callback?code=attacker-code&state=not-the-real-state',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/login?error=invalid_state');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a callback that arrives with no login in progress', async () => {
    // Login CSRF: a victim who never started the flow is sent an attacker's code.
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/discord/callback?code=attacker-code&state=anything',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/login?error=invalid_state');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rotates the session id when the login completes', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const preLoginCookie = sessionCookie(start)!;
    const state = stateOf(start.headers.location as string)!;
    mockDiscordExchangeSuccess();

    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=good-code&state=${state}`,
      headers: { cookie: preLoginCookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).not.toContain('error=');
    const postLoginCookie = sessionCookie(res);
    expect(postLoginCookie).toBeDefined();
    expect(sessionIdOf(postLoginCookie!)).not.toBe(sessionIdOf(preLoginCookie));

    // The rotated session is the authenticated one.
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: postLoginCookie! },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: 'player-1' });
  });

  it('keeps a pending device-flow pairing across the login', async () => {
    const device = await app.inject({ method: 'GET', url: '/api/auth/device?user_code=ABCD-EFGH' });
    expect(device.statusCode).toBe(302);
    const deviceCookie = sessionCookie(device)!;

    const start = await app.inject({
      method: 'GET',
      url: '/api/auth/discord',
      headers: { cookie: deviceCookie },
    });
    const state = stateOf(start.headers.location as string)!;
    const startCookie = sessionCookie(start) ?? deviceCookie;
    mockDiscordExchangeSuccess();

    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=good-code&state=${state}`,
      headers: { cookie: startCookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/api/auth/device?user_code=ABCD-EFGH');
  });
});
