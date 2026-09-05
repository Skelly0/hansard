import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { deviceCodes, mcpTokens, players, type Database } from '@hansard/db';
import '../types.js';
import type { SessionUser } from '../types.js';
import { findOrCreatePlayerByDiscordId, aggregatePermissionsForPlayer } from '../services/playerService.js';
import { requireMcpToken } from '../middleware/requireMcpToken.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MCP_TOKEN_SLIDING_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, refreshed on use
const MCP_TOKEN_ABSOLUTE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year hard cap
const DEVICE_POLL_INTERVAL_S = 5;

// Crockford-style alphabet (no I/O/0/1) so user codes are easy to read aloud.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 4-char block + dash + 4-char block, drawn from USER_CODE_ALPHABET.
const USER_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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

/**
 * Resolve the public-facing base URL for device-flow links. Falls back to
 * `request.protocol://request.hostname`, but production deployments should
 * set PUBLIC_API_URL so we don't trust the Host header (which `trustProxy`
 * lets clients control).
 */
function publicApiUrl(request: FastifyRequest): string {
  const fromEnv = process.env.PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${request.protocol}://${request.hostname}`;
}

export async function refreshSessionUser(
  db: Database,
  sessionUser: SessionUser,
): Promise<SessionUser | null> {
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.id, sessionUser.id))
    .limit(1);

  if (!player) return null;

  const permissions = await aggregatePermissionsForPlayer(db, player.id);
  return {
    id: player.id,
    discordId: player.discordId,
    username: player.discordUsername,
    avatar: sessionUser.avatar,
    isStaff: player.isStaff,
    staffRole: player.staffRole,
    permissions,
  };
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3001/api/auth/discord/callback';

  // GET /api/auth/discord — redirect to Discord OAuth2.
  // `state` is a per-session random nonce stored server-side and compared in
  // the callback, so an attacker cannot force a victim's browser through the
  // callback with a code the attacker obtained (login CSRF). It carries no
  // application data: device-flow context still travels only via
  // `session.pendingDeviceUserCode` (see /api/auth/device).
  fastify.get('/api/auth/discord', async (request: FastifyRequest, reply: FastifyReply) => {
    const state = generateOpaqueToken(16);
    request.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });

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

    // The callback only honours a code for a login *this* session started.
    // Single use: clear the nonce whether or not it matches.
    const expectedState = request.session.oauthState;
    request.session.oauthState = undefined;
    if (!expectedState || !state || !constantTimeEquals(expectedState, state)) {
      return reply.redirect(`${frontendUrl}/login?error=invalid_state`);
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

      // Rotate the session id across the privilege boundary so a session id
      // that existed before login (planted or merely observed) is never the
      // authenticated one. The pending device-flow code is the only field
      // that must survive, so the post-login hop below still works.
      await request.session.regenerate(['pendingDeviceUserCode']);

      request.session.user = {
        id: player.id,                        // players.id (UUID) — not Discord snowflake
        discordId: discordUser.id,
        username: player.discordUsername,
        avatar: discordUser.avatar,
        isStaff: player.isStaff,
        staffRole: player.staffRole,
        permissions,
      };

      // If a device-flow approval was pending in this session, hop straight
      // to the approval page. We trust this only because it was set in the
      // SAME session by the user's own click on /api/auth/device, not via
      // any URL parameter the OAuth provider echoed back.
      const pendingUserCode = request.session.pendingDeviceUserCode;
      if (pendingUserCode && USER_CODE_REGEX.test(pendingUserCode)) {
        return reply.redirect(`/api/auth/device?user_code=${encodeURIComponent(pendingUserCode)}`);
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

    const refreshed = await refreshSessionUser(fastify.db, user);
    if (!refreshed) {
      await request.session.destroy();
      return reply.status(401).send({ error: 'Session player no longer exists' });
    }

    request.session.user = refreshed;
    return refreshed;
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
    const deviceCodeHash = sha256Hex(deviceCode);
    const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);

    // Vanishingly rare collision retry — user_code has ~32^8 = 1.1e12 combos.
    // We catch Postgres 23505 on the unique-constraint INSERT to close the
    // SELECT-then-INSERT race; the prior pre-check is gone.
    let userCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateUserCode();
      try {
        await fastify.db.insert(deviceCodes).values({
          deviceCodeHash,
          userCode: candidate,
          interval: DEVICE_POLL_INTERVAL_S,
          expiresAt,
        });
        userCode = candidate;
        break;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === '23505') continue;
        throw err;
      }
    }
    if (!userCode) {
      // 5 collisions in a row is statistically impossible without contention
      // pathology; surface as 503 so the CLI can retry rather than wedge.
      return reply.status(503).send({ error: 'Could not allocate pairing code' });
    }

    const apiBase = publicApiUrl(request);
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
  //
  // The user_code is bound to the session immediately (not echoed through
  // OAuth state), and the alphabet is validated up front to keep arbitrary
  // strings from reaching the rendered <script>.
  fastify.get('/api/auth/device', async (request: FastifyRequest, reply: FastifyReply) => {
    const { user_code: userCode } = request.query as { user_code?: string };
    if (!userCode || !USER_CODE_REGEX.test(userCode)) {
      return reply.status(400).type('text/html').send(renderErrorPage(
        'Missing or malformed pairing code. Open the URL printed by <code>hansard-mcp login</code>.',
      ));
    }

    // Bind the pairing to the session before any redirect — that way the
    // post-Discord-OAuth callback only honours codes this same browser
    // initiated, not codes an attacker injected via an OAuth `state` param.
    request.session.pendingDeviceUserCode = userCode;

    if (!request.session.user) {
      return reply.redirect('/api/auth/discord');
    }

    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.userCode, userCode))
      .limit(1);

    if (!pairing) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(404).type('text/html').send(renderErrorPage(
        'That code is invalid or has already been used. Re-run <code>hansard-mcp login</code> to start over.',
      ));
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(410).type('text/html').send(renderErrorPage(
        'That code has expired. Re-run <code>hansard-mcp login</code> to start over.',
      ));
    }
    if (pairing.approved) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.type('text/html').send(renderSuccessPage('Already approved — you can close this tab.'));
    }

    return reply.type('text/html').send(renderConfirmPage(userCode, request.session.user.username));
  });

  // POST /api/auth/device — Approve button target (JSON fetch from the page).
  //
  // Three layers of CSRF defense:
  //   1. The pairing's user_code is read from the session, not the body, so
  //      an attacker who can forge a request can't choose which pairing to
  //      approve.
  //   2. Custom header `X-Hansard-Device-Approve: 1` is required. Browsers
  //      can't send custom headers on a cross-origin request without a
  //      CORS preflight, which our origin allowlist denies.
  //   3. The DB update is gated on `approved=false` so a single approval
  //      can't be replayed to re-bind a different player.
  fastify.post('/api/auth/device', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionUser = request.session.user;
    if (!sessionUser) {
      return reply.status(401).send({ error: 'Session expired' });
    }

    if (request.headers['x-hansard-device-approve'] !== '1') {
      return reply.status(403).send({ error: 'Missing CSRF guard header' });
    }

    const userCode = request.session.pendingDeviceUserCode;
    if (!userCode || !USER_CODE_REGEX.test(userCode)) {
      return reply.status(400).send({ error: 'No pending pairing on this session' });
    }

    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.userCode, userCode))
      .limit(1);

    if (!pairing) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(404).send({ error: 'Pairing not found' });
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(410).send({ error: 'Pairing expired' });
    }
    if (pairing.approved) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(409).send({ error: 'Pairing already approved' });
    }

    // Single-shot approval: only succeeds if the row is still `approved=false`.
    const updated = await fastify.db
      .update(deviceCodes)
      .set({ approved: true, playerId: sessionUser.id })
      .where(and(eq(deviceCodes.deviceCodeHash, pairing.deviceCodeHash), eq(deviceCodes.approved, false)))
      .returning({ deviceCodeHash: deviceCodes.deviceCodeHash });

    if (updated.length === 0) {
      request.session.pendingDeviceUserCode = undefined;
      return reply.status(409).send({ error: 'Pairing already approved' });
    }

    request.session.pendingDeviceUserCode = undefined;
    return { success: true, username: sessionUser.username };
  });

  // POST /api/auth/device/poll — CLI polls until the row is approved, then
  // the row is rotated into mcp_tokens (transactionally, exactly once) and
  // the bearer is returned.
  fastify.post('/api/auth/device/poll', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { device_code?: string };
    const deviceCode = body?.device_code;
    if (!deviceCode || typeof deviceCode !== 'string') {
      return reply.status(400).send({ error: 'Missing device_code' });
    }
    const deviceCodeHash = sha256Hex(deviceCode);

    // Pre-check outside the txn so we can reply 'pending' without a write.
    const [pairing] = await fastify.db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCodeHash, deviceCodeHash))
      .limit(1);

    if (!pairing) {
      return reply.status(404).send({ status: 'expired' });
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      await fastify.db.delete(deviceCodes).where(eq(deviceCodes.deviceCodeHash, deviceCodeHash));
      return reply.status(410).send({ status: 'expired' });
    }
    if (!pairing.approved || !pairing.playerId) {
      return { status: 'pending' };
    }

    // Approved — rotate the row exactly once. The DELETE returns the row
    // only if it was still present, so two concurrent pollers can't both
    // succeed in inserting a token.
    const token = generateOpaqueToken(32);
    const tokenHash = sha256Hex(token);
    const now = new Date();
    const playerId = pairing.playerId;

    const issued = await fastify.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(deviceCodes)
        .where(and(
          eq(deviceCodes.deviceCodeHash, deviceCodeHash),
          eq(deviceCodes.approved, true),
        ))
        .returning({ playerId: deviceCodes.playerId });

      if (deleted.length === 0 || !deleted[0].playerId) return false;

      await tx.insert(mcpTokens).values({
        tokenHash,
        playerId: deleted[0].playerId,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + MCP_TOKEN_SLIDING_TTL_MS),
        absoluteExpiresAt: new Date(now.getTime() + MCP_TOKEN_ABSOLUTE_TTL_MS),
      });
      return true;
    });

    if (!issued) {
      // Lost the race to a sibling poll. The other poller got the token; we
      // return 'expired' so the CLI knows to bail rather than retry forever.
      return reply.status(410).send({ status: 'expired' });
    }

    return { status: 'approved', token, player_id: playerId };
  });

  // GET /api/auth/mcp/me — bearer-auth identity + permissions for the MCP server.
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
  // requireMcpToken stashes the resolved tokenHash on request so we don't
  // re-parse the Authorization header here.
  fastify.post('/api/auth/mcp/revoke', { preHandler: requireMcpToken }, async (request: FastifyRequest) => {
    const tokenHash = request.mcpTokenHash!;
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash));
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
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .muted { color: #7a6f63; font-size: 0.9rem; }
  .warn { background: #fdf2dc; border-left: 3px solid #d4a72c; padding: 0.6rem 0.9rem; margin: 1rem 0; font-size: 0.95rem; }
</style>
</head><body><div class="card">${body}</div></body></html>`;
}

function renderConfirmPage(userCode: string, username: string): string {
  // userCode has already been validated against USER_CODE_REGEX by the
  // GET handler, so it's safe to interpolate; we still escape defensively.
  const safeCode = escapeHtml(userCode);
  return pageShell('Approve MCP access', `
    <h1>Approve Hansard MCP access</h1>
    <p>Logged in as <strong>${escapeHtml(username)}</strong>. The pairing code on this page should match the one printed by your CLI:</p>
    <p class="code codeblock">${safeCode}</p>
    <div class="warn">
      <strong>Only approve if you ran <code>hansard-mcp login</code> yourself</strong> and the codes match.
      Anyone with this token can read Hansard data as you for up to 90 days.
    </div>
    <button id="approve-btn" type="button">Approve</button>
    <p id="status" class="muted" style="margin-top:1.5rem"></p>
    <script>
      (function () {
        var btn = document.getElementById('approve-btn');
        var status = document.getElementById('status');
        btn.addEventListener('click', function () {
          btn.disabled = true;
          status.textContent = 'Approving…';
          fetch('/api/auth/device', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Hansard-Device-Approve': '1'
            },
            credentials: 'same-origin',
            body: '{}'
          }).then(function (res) {
            return res.json().then(function (data) { return { ok: res.ok, data: data }; });
          }).then(function (r) {
            if (r.ok && r.data.success) {
              document.querySelector('.card').innerHTML =
                '<h1>Approved</h1><p>The CLI will pick up automatically. You can close this tab.</p>';
            } else {
              status.textContent = (r.data && r.data.error) || 'Something went wrong.';
              btn.disabled = false;
            }
          }).catch(function (err) {
            status.textContent = 'Network error: ' + (err && err.message ? err.message : err);
            btn.disabled = false;
          });
        });
      })();
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
