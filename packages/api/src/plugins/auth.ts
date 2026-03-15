import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import '../types.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export default fp(async function authPlugin(fastify: FastifyInstance) {
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3001/api/auth/discord/callback';

  // GET /api/auth/discord — redirect to Discord OAuth2
  fastify.get('/api/auth/discord', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
    });

    return reply.redirect(`${DISCORD_AUTH_URL}?${params.toString()}`);
  });

  // GET /api/auth/discord/callback — handle OAuth2 callback
  fastify.get('/api/auth/discord/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = request.query as { code?: string };

    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        fastify.log.error('Discord token exchange failed: %s', tokenResponse.status);
        return reply.status(502).send({ error: 'Discord token exchange failed' });
      }

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        token_type: string;
      };

      // Fetch user profile from Discord
      const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
      });

      if (!userResponse.ok) {
        fastify.log.error('Discord user fetch failed: %s', userResponse.status);
        return reply.status(502).send({ error: 'Failed to fetch Discord user' });
      }

      const discordUser = await userResponse.json() as {
        id: string;
        username: string;
        discriminator: string;
        avatar: string | null;
      };

      // Store user in session
      // TODO: Look up user in DB, check staff/roles
      request.session.user = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
        isStaff: false, // stub — will be resolved from DB
        permissions: [],
      };

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return reply.redirect(`${frontendUrl}/dashboard`);
    } catch (err) {
      fastify.log.error(err, 'OAuth2 callback error');
      return reply.status(500).send({ error: 'Internal server error during authentication' });
    }
  });

  // GET /api/auth/me — return current session user
  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.session.user;
    if (!user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    return user;
  });

  // POST /api/auth/logout — destroy session
  fastify.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    request.session.destroy();
    return { success: true };
  });
}, { name: 'auth' });
