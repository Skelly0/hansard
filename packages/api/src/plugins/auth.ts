import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { deviceCodes, mcpTokens } from '@hansard/db';
import '../types.js';
import { findOrCreatePlayerByDiscordId, aggregatePermissionsForPlayer } from '../services/playerService.js';
import { requireMcpToken } from '../middleware/requireMcpToken.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MCP_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, sliding
const DEVICE_POLL_INTERVAL_S = 5;

// Crockford-style alphabet (no I/O/0/1) so user codes are easy to read aloud.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;',
  );
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3001/api/auth/discord/callback';

  // GET /api/auth/discord — redirect to Discord OAuth2
  fastify.get('/api/auth/discord', async (request: FastifyRequest, reply: FastifyReply) => {
    const { state } = request.query as { state?: string };
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
    });
    if (state) params.set('state', state);

    return reply.redirect(`${DISCORD_AUTH_URL}?${params.toString()}`);
  });

  // GET /api/auth/discord/callback — handle OAuth2 callback
  fastify.get('/api/auth/discord/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, error, state } = request.query as { code?: string; error?: string; state?: string };
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

      // If this was a device-flow login, hop straight to the approval page
      // with the user_code preserved (so the user doesn't have to retype it).
      if (state && state.startsWith('device:')) {
        const userCode = state.slice('device:'.length);
        return reply.redirect(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`);
      }

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

  // ============================================================
  // Device-flow endpoints — used by the @hansard/mcp CLI to obtain
  // a long-lived bearer token after the user approves in the browser.
  // ============================================================

  // POST /api/auth/device/init — CLI calls this first; returns a pending pairing.
  fastify.post('/api/auth/device/init', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const deviceCode = generateOpaqueToken(32);
    let userCode = generateUserCode();
    // Vanishingly rare collision retry — user_code has ~32^8 = 1.1e12 combos.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await fastify.db
        .select({ deviceCode: deviceCodes.deviceCode })
        .from(deviceCodes)
        .where(eq(deviceCodes.userCode, userCode))
        .limit(1);
      if (existing.length === 0) break;
      userCode = generateUserCode();
    }

    const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);
    await fastify.db.insert(deviceCodes).values({
      deviceCode,
      userCode,
      interval: DEVICE_POLL_INTERVAL_S,
      expiresAt,
    });

    const apiBase = `${request.protocol}://${request.hostname}`;
    const verificationUri = `${apiBase}/api/auth/device`;
    const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      interval: DEVICE_POLL_INTERVAL_S,
      expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    };
  });

  // GET /api/auth/device — browser-facing approval page.
  // - Not logged in: bounce through Discord OAuth, preserving the user_code.
  // - Logged in, GET: render confirmation page with an "Approve" button.
  // - The Approve button POSTs back to the same path (handled below).
  fastify.get('/api/auth/device', async (request: FastifyRequest, reply: FastifyReply) => {
    const { user_code: userCode } = request.query as { user_code?: string };
    if (!userCode) {
      return reply.status(400).type('text/html').send(renderErrorPage('Missing user_code in URL.'));
    }

    if (!request.session.user) {
      return reply.redirect(`/api/auth/discord?state=${encodeURIComponent(`device:${userCode}`)}`);
    }

    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.userCode, userCode))
      .limit(1);

    if (!pairing) {
      return reply.status(404).type('text/html').send(renderErrorPage(
        'That code is invalid or has already been used. Re-run <code>hansard-mcp login</code> to start over.',
      ));
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      return reply.status(410).type('text/html').send(renderErrorPage(
        'That code has expired. Re-run <code>hansard-mcp login</code> to start over.',
      ));
    }
    if (pairing.approved) {
      return reply.type('text/html').send(renderSuccessPage('Already approved — you can close this tab.'));
    }

    return reply.type('text/html').send(renderConfirmPage(userCode, request.session.user.username));
  });

  // POST /api/auth/device — Approve button target (JSON fetch from the page).
  // Marks the row approved and binds the player_id from the current session.
  fastify.post('/api/auth/device', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionUser = request.session.user;
    if (!sessionUser) {
      return reply.status(401).send({ error: 'Session expired' });
    }

    const body = request.body as { user_code?: string };
    const userCode = body?.user_code;
    if (!userCode) {
      return reply.status(400).send({ error: 'Missing user_code' });
    }

    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.userCode, userCode))
      .limit(1);

    if (!pairing) {
      return reply.status(404).send({ error: 'Pairing not found' });
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      return reply.status(410).send({ error: 'Pairing expired' });
    }

    await fastify.db
      .update(deviceCodes)
      .set({ approved: true, playerId: sessionUser.id })
      .where(eq(deviceCodes.deviceCode, pairing.deviceCode));

    return { success: true, username: sessionUser.username };
  });

  // POST /api/auth/device/poll — CLI polls until the row is approved, then
  // the row is rotated into mcp_tokens and the bearer is returned.
  fastify.post('/api/auth/device/poll', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { device_code?: string };
    const deviceCode = body?.device_code;
    if (!deviceCode) {
      return reply.status(400).send({ error: 'Missing device_code' });
    }

    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCode, deviceCode))
      .limit(1);

    if (!pairing) {
      return reply.status(404).send({ status: 'expired' });
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      await fastify.db.delete(deviceCodes).where(eq(deviceCodes.deviceCode, deviceCode));
      return reply.status(410).send({ status: 'expired' });
    }
    if (!pairing.approved || !pairing.playerId) {
      return { status: 'pending' };
    }

    // Approved → rotate into mcp_tokens, then delete the device-code row.
    const token = generateOpaqueToken(32);
    const now = new Date();
    await fastify.db.insert(mcpTokens).values({
      token,
      playerId: pairing.playerId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + MCP_TOKEN_TTL_MS),
    });
    await fastify.db.delete(deviceCodes).where(eq(deviceCodes.deviceCode, deviceCode));

    return { status: 'approved', token, player_id: pairing.playerId };
  });

  // GET /api/auth/mcp/me — bearer-auth identity + permissions for the MCP server.
  // Mirrors /api/auth/me's payload (minus avatar/discordId, since those aren't
  // useful to the LLM client).
  fastify.get('/api/auth/mcp/me', { preHandler: requireMcpToken }, async (request: FastifyRequest) => {
    const player = request.player!;
    const permissions = await aggregatePermissionsForPlayer(fastify.db, player.id);
    return {
      id: player.id,
      discordId: player.discordId,
      username: player.discordUsername,
      characterName: player.characterName,
      isStaff: player.isStaff,
      staffRole: player.staffRole,
      permissions,
    };
  });

  // POST /api/auth/mcp/revoke — bearer-auth; deletes the calling token.
  fastify.post('/api/auth/mcp/revoke', { preHandler: requireMcpToken }, async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization!;
    const token = authHeader.slice('Bearer '.length).trim();
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.token, token));
    return { success: true };
  });
}, { name: 'auth' });

// ============================================================
// Approval-page HTML (small inline templates — keep in this file
// since they're only used by device-flow and don't need theming).
// ============================================================

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)} — Hansard</title>
<style>
  body { font-family: 'Lora', Georgia, serif; background: #f5efe6; color: #2b2622; margin: 0; padding: 2rem; }
  .card { max-width: 520px; margin: 4rem auto; background: #fffaf2; border: 1px solid #d8cfc1; border-radius: 6px; padding: 2rem 2.5rem; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
  h1 { font-family: 'Crimson Pro', 'Times New Roman', serif; font-weight: 600; margin-top: 0; color: #b94a48; }
  code, .code { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; background: #f0e8db; padding: 0.1em 0.4em; border-radius: 3px; }
  .codeblock { display: inline-block; font-size: 1.4rem; letter-spacing: 0.1em; padding: 0.6rem 1rem; margin: 0.5rem 0 1.5rem; }
  button { font-family: inherit; font-size: 1rem; padding: 0.6rem 1.4rem; background: #b94a48; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #a23f3d; }
  .muted { color: #7a6f63; font-size: 0.9rem; }
</style>
</head><body><div class="card">${body}</div></body></html>`;
}

function renderConfirmPage(userCode: string, username: string): string {
  const safeCode = escapeHtml(userCode);
  return pageShell('Approve MCP access', `
    <h1>Approve Hansard MCP access</h1>
    <p>An external LLM client is asking to act on your behalf as <strong>${escapeHtml(username)}</strong>. The pairing code shown by the CLI is:</p>
    <p class="code codeblock">${safeCode}</p>
    <p>Approving will grant a 90-day token that can call read-only Hansard tools as you. You can revoke it any time with <code>hansard-mcp logout</code>.</p>
    <button id="approve-btn" type="button">Approve</button>
    <p id="status" class="muted" style="margin-top:1.5rem"></p>
    <p class="muted" style="margin-top:2rem">If you didn't start this, just close this tab — the CLI will time out and nothing happens.</p>
    <script>
      const btn = document.getElementById('approve-btn');
      const status = document.getElementById('status');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'Approving…';
        try {
          const res = await fetch('/api/auth/device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ user_code: ${JSON.stringify(userCode)} }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            document.querySelector('.card').innerHTML = '<h1>Approved</h1><p>Approved as <strong>' + (data.username || '') + '</strong>. You can close this tab — the CLI will pick up automatically.</p>';
          } else {
            status.textContent = data.error || 'Something went wrong.';
            btn.disabled = false;
          }
        } catch (err) {
          status.textContent = 'Network error: ' + err.message;
          btn.disabled = false;
        }
      });
    </script>
  `);
}

function renderSuccessPage(message: string): string {
  return pageShell('Approved', `
    <h1>Approved</h1>
    <p>${message}</p>
  `);
}

function renderErrorPage(message: string): string {
  return pageShell('Error', `
    <h1>Something went wrong</h1>
    <p>${message}</p>
  `);
}
