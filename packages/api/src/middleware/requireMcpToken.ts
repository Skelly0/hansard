import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mcpTokens, players } from '@hansard/db';
import '../types.js';

const SLIDING_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * preHandler hook for MCP-token routes. Reads `Authorization: Bearer <token>`,
 * looks the row up in `mcp_tokens` by its sha-256 hash (the DB never stores
 * plaintext), enforces both the sliding 90-day expiry AND the absolute 1-year
 * cap, and refreshes `last_used_at`/`expires_at`. Attaches the player record
 * on `request.player`.
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

  const tokenHash = sha256Hex(token);
  const fastify = request.server as FastifyInstance;

  const [row] = await fastify.db
    .select()
    .from(mcpTokens)
    .where(eq(mcpTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  const now = new Date();
  const nowMs = now.getTime();

  if (row.absoluteExpiresAt.getTime() < nowMs || row.expiresAt.getTime() < nowMs) {
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash));
    return reply.status(401).send({ error: 'Token expired' });
  }

  const [player] = await fastify.db
    .select()
    .from(players)
    .where(eq(players.id, row.playerId))
    .limit(1);

  if (!player) {
    await fastify.db.delete(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash));
    return reply.status(401).send({ error: 'Player no longer exists' });
  }

  // Slide the sliding expiry forward, but never past the absolute cap. A
  // constantly-used token still rotates after a year.
  const slidingTarget = new Date(nowMs + SLIDING_TTL_MS);
  const newExpiresAt = slidingTarget.getTime() < row.absoluteExpiresAt.getTime()
    ? slidingTarget
    : row.absoluteExpiresAt;

  await fastify.db
    .update(mcpTokens)
    .set({ lastUsedAt: now, expiresAt: newExpiresAt })
    .where(eq(mcpTokens.tokenHash, tokenHash));

  request.player = player;
  request.mcpTokenHash = tokenHash;
}
