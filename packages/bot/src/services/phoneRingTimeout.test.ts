import { describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

// phoneRingTimeout pulls in phoneRelay which pulls in `../db.js`, which throws at
// import without DATABASE_URL set. Tests don't actually touch the DB.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const { expireRingingCalls } = await import('./phoneRingTimeout.js');
const { phoneCalls } = await import('@hansard/db');

type CapturedUpdate = {
  setArg: unknown;
  whereArg: unknown;
};

/**
 * Build a mocked Drizzle db whose `update().set().where().returning()` chain resolves to
 * `returningRows`, while capturing the `set` payload and the `where` predicate so tests can
 * assert exactly what the worker (via PhoneService.expireRingingCalls) writes and filters on.
 */
function buildDb(returningRows: unknown[]): { db: unknown; captured: CapturedUpdate } {
  const captured: CapturedUpdate = { setArg: undefined, whereArg: undefined };
  return {
    captured,
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn((setArg: unknown) => {
          captured.setArg = setArg;
          return {
            where: vi.fn((whereArg: unknown) => {
              captured.whereArg = whereArg;
              return {
                returning: vi.fn().mockResolvedValue(returningRows),
              };
            }),
          };
        }),
      })),
    },
  };
}

/**
 * Cycle-safe recursive collector for string values nested anywhere inside a Drizzle SQL
 * predicate (chunks, params, column names). Drizzle column objects reference their table
 * which references its columns, so a plain JSON.stringify throws.
 */
function collectStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out: string[] = [];
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...collectStrings(v, seen));
  }
  return out;
}

describe('expireRingingCalls', () => {
  it('marks all overdue ringing calls missed and returns the swept rows', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const swept = [
      { id: 'call-1', status: 'missed', endedReason: 'ring_timeout' },
      { id: 'call-2', status: 'missed', endedReason: 'ring_timeout' },
    ];
    const { db, captured } = buildDb(swept);

    const { expired } = await expireRingingCalls(db as any, { now });
    expect(expired).toEqual(swept);

    // The UPDATE must transition rows to `missed` with the ring_timeout reason.
    expect(captured.setArg).toEqual(
      expect.objectContaining({ status: 'missed', endedReason: 'ring_timeout' }),
    );
  });

  it('restricts the UPDATE to status=ringing rows whose ring has expired', async () => {
    // Regression lock for the WHERE predicate: a change to e.g.
    // inArray(status, ['ringing','active']) would corrupt live calls — this must catch it.
    const now = new Date('2026-05-11T12:00:00.000Z');
    const { db, captured } = buildDb([]);

    await expireRingingCalls(db as any, { now });

    // PhoneService.expireRingingCalls filters on:
    //   and(eq(phoneCalls.status, 'ringing'), sql`ring_expires_at IS NOT NULL AND ring_expires_at < ${now}`)
    const expectedWhere = and(
      eq(phoneCalls.status, 'ringing'),
      sql`ring_expires_at IS NOT NULL AND ring_expires_at < ${now}`,
    );
    expect(captured.whereArg).toEqual(expectedWhere);

    // Belt-and-braces: walk the predicate's chunks (cycle-safe — Drizzle column objects
    // self-reference their table) and confirm it literally carries the 'ringing' value and
    // the ring_expires_at SQL, and was NOT broadened to also sweep 'active' calls.
    const strings = collectStrings(captured.whereArg);
    expect(strings).toContain('ringing');
    expect(strings.some((s) => s.includes('ring_expires_at'))).toBe(true);
    expect(strings).not.toContain('active');
  });

  it('returns empty list when no calls expired', async () => {
    const { db } = buildDb([]);
    const { expired } = await expireRingingCalls(db as any, {});
    expect(expired).toEqual([]);
  });

  it('does not attempt fan-out notifications when no client is provided', async () => {
    const { db } = buildDb([{ id: 'call-1' }]);
    // No client passed — call should succeed without throwing.
    await expect(expireRingingCalls(db as any, {})).resolves.toBeDefined();
  });

  it('logs and returns an empty list when the DB call throws', async () => {
    const failingDb = {
      update: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const logger = { error: vi.fn(), log: vi.fn() };
    const { expired } = await expireRingingCalls(failingDb as any, { logger });
    expect(expired).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('sweepStrandedActiveCalls', () => {
  it('returns the swept active calls', async () => {
    const { sweepStrandedActiveCalls } = await import('./phoneRingTimeout.js');
    const swept = [{ id: 'call-1', status: 'ended', endedReason: 'session_reset' }];
    const { db } = buildDb(swept);
    const { ended } = await sweepStrandedActiveCalls(db as any, { maxAgeMs: 1000 });
    expect(ended).toEqual(swept);
  });
});
