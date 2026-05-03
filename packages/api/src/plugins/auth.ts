import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import '../types.js';
import { findOrCreatePlayerByDiscordId, aggregatePermissionsForPlayer } from '../services/playerService.js';

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
    const { code, error } = request.query as { code?: string; error?: string };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Generic error redirect (covers access_denied, server_error, invalid_request, etc.)
    if (error) {
      return reply.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return reply.redirect(`${frontendUrl}/login?error=missing_code`);
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
        return reply.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
      }

      const tokenData = await tokenResponse.json() as { access_token: string; token_type: string };

      // Fetch Discord profile
      const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
      });

      if (!userResponse.ok) {
        fastify.log.error('Discord user fetch failed: %s', userResponse.status);
        return reply.redirect(`${frontendUrl}/login?error=profile_fetch_failed`);
      }

      const discordUser = await userResponse.json() as {
        id: string;
        username: string;
        avatar: string | null;
      };

      // Find or create player; aggregate permissions
      const { player } = await findOrCreatePlayerByDiscordId(fastify.db, {
        discordId: discordUser.id,
        discordUsername: discordUser.username,
      });
      const permissions = await aggregatePermissionsForPlayer(fastify.db, player.id);

      request.session.user = {
        id: player.id,                        // players.id (UUID) — not Discord snowflake
        discordId: discordUser.id,
        username: player.discordUsername,
        avatar: discordUser.avatar,
        isStaff: player.isStaff,
        staffRole: player.staffRole,
        permissions,
      };

      return reply.redirect(`${frontendUrl}/`);
    } catch (err) {
      fastify.log.error(err, 'OAuth2 callback error');
      return reply.redirect(`${frontendUrl}/login?error=server_error`);
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
