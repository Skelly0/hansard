import type { SessionStore } from '@fastify/session';
import { eq } from 'drizzle-orm';
import { sessions, type Database } from '@hansard/db';

// Derive the exact shapes @fastify/session expects from the store so this
// implementation stays in lock-step with the installed version.
type StoredSession = Parameters<SessionStore['set']>[1];
type GetCallback = Parameters<SessionStore['get']>[1];
type ErrCallback = Parameters<SessionStore['set']>[2];

// Matches the session cookie's `maxAge` in app.ts. Only used if a session is
// somehow handed to us without a resolvable cookie expiry.
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function expiryFromSession(session: StoredSession): Date {
  const expires = session?.cookie?.expires;
  if (expires) {
    const date = expires instanceof Date ? expires : new Date(expires);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(Date.now() + FALLBACK_TTL_MS);
}

/**
 * Postgres-backed @fastify/session store.
 *
 * The default store keeps sessions in process memory, so every API
 * restart/redeploy (frequent on Railway) drops every session and logs every
 * web user out. Persisting to Postgres makes sessions survive restarts; the
 * plugin's rolling-cookie behaviour then keeps active users logged in via a
 * sliding window.
 *
 * Expired rows are cleaned up lazily on read — there is no background sweeper.
 */
export class DrizzleSessionStore implements SessionStore {
  constructor(private readonly db: Database) {}

  set(sessionId: string, session: StoredSession, callback: ErrCallback): void {
    const expiresAt = expiryFromSession(session);
    this.db
      .insert(sessions)
      .values({ sid: sessionId, sess: session, expiresAt })
      .onConflictDoUpdate({
        target: sessions.sid,
        set: { sess: session, expiresAt },
      })
      .then(
        () => callback(),
        (err) => callback(err),
      );
  }

  get(sessionId: string, callback: GetCallback): void {
    this.db
      .select({ sess: sessions.sess, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.sid, sessionId))
      .limit(1)
      .then(
        (rows) => {
          const row = rows[0];
          if (!row) {
            callback(null, null);
            return;
          }
          if (row.expiresAt.getTime() <= Date.now()) {
            // Lapsed — drop the row and report it missing so the plugin mints
            // a fresh anonymous session. Best-effort: a failed delete just
            // leaves a dead row for the next read to retry.
            this.db.delete(sessions).where(eq(sessions.sid, sessionId)).then(
              () => {},
              () => {},
            );
            callback(null, null);
            return;
          }
          callback(null, row.sess as StoredSession);
        },
        (err) => callback(err),
      );
  }

  destroy(sessionId: string, callback: ErrCallback): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.sid, sessionId))
      .then(
        () => callback(),
        (err) => callback(err),
      );
  }
}
