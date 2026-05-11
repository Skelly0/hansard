import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messageExportRoutes from './messageExports';

const auth = vi.hoisted(() => ({
  authenticated: true,
  isStaff: true,
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any, reply: any) => {
    if (!auth.authenticated) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    request.session = { user: { id: 'viewer-player' } };
    request.player = { id: 'viewer-player', isStaff: auth.isStaff };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async (request: any, reply: any) => {
    if (!request.player?.isStaff) {
      return reply.status(403).send({ error: 'Staff access required' });
    }
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  await app.register(messageExportRoutes);
  return app;
}

function stubDiscordFetch() {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const text = String(url);
    if (text === 'https://discord.com/api/v10/channels/channel-1') {
      return jsonResponse({ id: 'channel-1', name: 'general' });
    }
    if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
      return jsonResponse([{
        id: 'message-1',
        channel_id: 'channel-1',
        author: { id: 'author-1', username: 'Ada', bot: false },
        timestamp: '2026-05-11T11:00:00.000Z',
        content: 'A useful event.',
        attachments: [],
        embeds: [],
      }]);
    }
    throw new Error(`Unexpected fetch ${text}`);
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

describe('message export routes', () => {
  const originalEnv = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    MESSAGE_EXPORT_CHANNEL_IDS: process.env.MESSAGE_EXPORT_CHANNEL_IDS,
  };

  beforeEach(() => {
    auth.authenticated = true;
    auth.isStaff = true;
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.MESSAGE_EXPORT_CHANNEL_IDS = 'channel-1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv.DISCORD_BOT_TOKEN === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalEnv.DISCORD_BOT_TOKEN;
    }
    if (originalEnv.MESSAGE_EXPORT_CHANNEL_IDS === undefined) {
      delete process.env.MESSAGE_EXPORT_CHANNEL_IDS;
    } else {
      process.env.MESSAGE_EXPORT_CHANNEL_IDS = originalEnv.MESSAGE_EXPORT_CHANNEL_IDS;
    }
  });

  it('requires authentication', async () => {
    auth.authenticated = false;
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export');

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Authentication required' });
  });

  it('requires staff access', async () => {
    auth.isStaff = false;
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export');

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Staff access required' });
  });

  it('returns 503 when the bot token or channel allowlist is missing', async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export');

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'Message export is not configured',
    });
  });

  it('rejects channel subsets outside the allowlist', async () => {
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export?channelIds=channel-2');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'Requested channels are not exportable',
      invalidChannelIds: ['channel-2'],
    });
  });

  it('rejects export windows longer than 24 hours without calling Discord', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Discord should not be called');
    });
    vi.stubGlobal('fetch', fetchImpl);
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export?hours=25');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'hours must be an integer from 1 to 24' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a JSON export by default', async () => {
    stubDiscordFetch();
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export?hours=24&maxMessages=10');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      messages: [{
        id: 'message-1',
        channelId: 'channel-1',
        channelName: 'general',
        authorId: 'author-1',
        authorName: 'Ada',
        authorIsBot: false,
        content: 'A useful event.',
      }],
      channels: [{
        id: 'channel-1',
        name: 'general',
        status: 'ok',
        messageCount: 1,
      }],
      truncated: false,
    });
  });

  it('returns markdown when requested', async () => {
    stubDiscordFetch();
    const app = await appWithRoutes();

    const res = await app.inject('/api/messages/export?format=markdown');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('# Hansard Message Export');
    expect(res.body).toContain('[2026-05-11T11:00:00.000Z] #general Ada: A useful event.');
  });
});
