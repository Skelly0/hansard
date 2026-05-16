import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@hansard/db';
import { DrizzleSessionStore } from './sessionStore';

type SetSession = Parameters<DrizzleSessionStore['set']>[1];

function makeSession(expires: Date | null | undefined, extra: Record<string, unknown> = {}): SetSession {
  return { cookie: { originalMaxAge: null, expires }, ...extra } as SetSession;
}

interface MockDbOpts {
  insertResult?: Promise<unknown>;
  selectRows?: unknown[];
  selectReject?: unknown;
  deleteResult?: Promise<unknown>;
}

function makeMockDb(opts: MockDbOpts = {}) {
  const spies = {
    insert: vi.fn(),
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    select: vi.fn(),
    whereSelect: vi.fn(),
    delete: vi.fn(),
    whereDelete: vi.fn(),
  };

  const insertChain = {
    values: (v: unknown) => {
      spies.values(v);
      return {
        onConflictDoUpdate: (c: unknown) => {
          spies.onConflictDoUpdate(c);
          return opts.insertResult ?? Promise.resolve();
        },
      };
    },
  };

  const selectChain = {
    from: () => ({
      where: (w: unknown) => {
        spies.whereSelect(w);
        return {
          limit: () =>
            'selectReject' in opts
              ? Promise.reject(opts.selectReject)
              : Promise.resolve(opts.selectRows ?? []),
        };
      },
    }),
  };

  const deleteChain = {
    where: (w: unknown) => {
      spies.whereDelete(w);
      return opts.deleteResult ?? Promise.resolve();
    },
  };

  const db = {
    insert: (...args: unknown[]) => {
      spies.insert(...args);
      return insertChain;
    },
    select: (...args: unknown[]) => {
      spies.select(...args);
      return selectChain;
    },
    delete: (...args: unknown[]) => {
      spies.delete(...args);
      return deleteChain;
    },
  } as unknown as Database;

  return { db, spies };
}

function runSet(store: DrizzleSessionStore, sid: string, session: SetSession) {
  return new Promise<{ err: unknown }>((resolve) => {
    store.set(sid, session, (err) => resolve({ err }));
  });
}

function runGet(store: DrizzleSessionStore, sid: string) {
  return new Promise<{ err: unknown; result: unknown }>((resolve) => {
    store.get(sid, (err, result) => resolve({ err, result }));
  });
}

function runDestroy(store: DrizzleSessionStore, sid: string) {
  return new Promise<{ err: unknown }>((resolve) => {
    store.destroy(sid, (err) => resolve({ err }));
  });
}

describe('DrizzleSessionStore.set', () => {
  it('upserts the session keyed by sid with the cookie expiry', async () => {
    const { db, spies } = makeMockDb();
    const store = new DrizzleSessionStore(db);
    const expires = new Date('2030-01-01T00:00:00.000Z');
    const session = makeSession(expires, { user: { id: 'player-1' } });

    const { err } = await runSet(store, 'sid-1', session);

    expect(err).toBeUndefined();
    expect(spies.values).toHaveBeenCalledWith({
      sid: 'sid-1',
      sess: session,
      expiresAt: expires,
    });
    expect(spies.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { sess: session, expiresAt: expires } }),
    );
  });

  it('falls back to a ~7-day expiry when the session has no cookie expiry', async () => {
    const { db, spies } = makeMockDb();
    const store = new DrizzleSessionStore(db);

    await runSet(store, 'sid-2', makeSession(null));

    const { expiresAt } = spies.values.mock.calls[0][0] as { expiresAt: Date };
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + sevenDaysMs - 5_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 1_000);
  });

  it('reports the error when the upsert rejects', async () => {
    const failure = new Error('db down');
    const { db } = makeMockDb({ insertResult: Promise.reject(failure) });
    const store = new DrizzleSessionStore(db);

    const { err } = await runSet(store, 'sid-3', makeSession(new Date()));

    expect(err).toBe(failure);
  });
});

describe('DrizzleSessionStore.get', () => {
  it('returns the stored session for a live row', async () => {
    const sess = { cookie: { originalMaxAge: null }, user: { id: 'player-1' } };
    const { db } = makeMockDb({
      selectRows: [{ sess, expiresAt: new Date(Date.now() + 60_000) }],
    });
    const store = new DrizzleSessionStore(db);

    const { err, result } = await runGet(store, 'sid-1');

    expect(err).toBeNull();
    expect(result).toBe(sess);
  });

  it('returns null when no row exists', async () => {
    const { db, spies } = makeMockDb({ selectRows: [] });
    const store = new DrizzleSessionStore(db);

    const { err, result } = await runGet(store, 'missing');

    expect(err).toBeNull();
    expect(result).toBeNull();
    expect(spies.delete).not.toHaveBeenCalled();
  });

  it('treats an expired row as missing and deletes it', async () => {
    const { db, spies } = makeMockDb({
      selectRows: [{ sess: { user: {} }, expiresAt: new Date(Date.now() - 60_000) }],
    });
    const store = new DrizzleSessionStore(db);

    const { err, result } = await runGet(store, 'stale');

    expect(err).toBeNull();
    expect(result).toBeNull();
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.whereDelete).toHaveBeenCalledTimes(1);
  });

  it('reports the error when the lookup rejects', async () => {
    const failure = new Error('select failed');
    const { db } = makeMockDb({ selectReject: failure });
    const store = new DrizzleSessionStore(db);

    const { err, result } = await runGet(store, 'sid-1');

    expect(err).toBe(failure);
    expect(result).toBeUndefined();
  });
});

describe('DrizzleSessionStore.destroy', () => {
  it('deletes the row and reports no error', async () => {
    const { db, spies } = makeMockDb();
    const store = new DrizzleSessionStore(db);

    const { err } = await runDestroy(store, 'sid-1');

    expect(err).toBeUndefined();
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.whereDelete).toHaveBeenCalledTimes(1);
  });

  it('reports the error when the delete rejects', async () => {
    const failure = new Error('delete failed');
    const { db } = makeMockDb({ deleteResult: Promise.reject(failure) });
    const store = new DrizzleSessionStore(db);

    const { err } = await runDestroy(store, 'sid-1');

    expect(err).toBe(failure);
  });
});
