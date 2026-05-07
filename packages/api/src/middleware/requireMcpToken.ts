import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { mcpTokens, players } from '@hansard/db';
import '../types.js';

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, sliding

/**
 * preHandler hook for MCP-token routes. Reads `Authorization: Bearer <token>`,
 * looks the row up in `mcp_tokens`, refreshes `last_used_at`/`expires_at`, and
 * attaches the player record on `request.player`. Returns 401 on any failure.
 *
 * Used only by /api/auth/mcp/*. Other routes still use the session-based
 * `requireAuth`; the two auth paths don't mix.
 */
export async function requireMcpToken(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing bearer token' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return reply.status(401).send({ error: 'Empty bearer token' });
  }

  const fastify = request.server as FastifyInstance;

  const [row] = await fastify.db
    .select()
    .from(mcpTokens)
    .where(eq(mcpTokens.token, token))
    .limit(1);

  if (!row) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (row.expiresAt.getTime() < Date.now()) {
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.token, token));
    return reply.status(401).send({ error: 'Token expired' });
  }

  const [player] = await fastify.db
    .select()
    .from(players)
    .where(eq(players.id, row.playerId))
    .limit(1);

  if (!player) {
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.token, token));
    return reply.status(401).send({ error: 'Player no longer exists' });
  }

  // Slide the expiry forward on every successful auth.
  const now = new Date();
  await fastify.db
    .update(mcpTokens)
    .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS) })
    .where(eq(mcpTokens.token, token));

  request.player = player;
}
