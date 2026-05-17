import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNotNull, lt } from 'drizzle-orm';

// phoneRingTimeout pulls in phoneRelay which pulls in `../db.js`, which throws at
// import without DATABASE_URL set. Tests don't actually touch the DB.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const relayMocks = vi.hoisted(() => ({
  disableRingDmButtons: vi.fn(),
  hangUpAndNotify: vi.fn(),
  sendVoicemailBeep: vi.fn(),
}));

vi.mock('../utils/phoneRelay.js', () => relayMocks);

const {
  expireRingingCalls,
  processPendingVoicemailBeeps,
  sweepClaimedVoicemailBeeps,
  sweepAbandonedVoicemails,
} = await import('./phoneRingTimeout.js');
const { phoneCalls } = await import('@hansard/db');

type CapturedUpdate = {
  setArg: unknown;
  whereArg: unknown;
  setArgs: unknown[];
  whereArgs: unknown[];
};

/**
 * Build a mocked Drizzle db whose `update().set().where().returning()` chain resolves to
 * `returningRows`, while capturing the `set` payload and the `where` predicate so tests can
 * assert exactly what the worker (via PhoneService.expireRingingCalls) writes and filters on.
 */
function buildDb(
  returningRows: unknown[] | unknown[][],
  selectRows: unknown[][] = [],
): { db: unknown; captured: CapturedUpdate } {
  const captured: CapturedUpdate = { setArg: undefined, whereArg: undefined, setArgs: [], whereArgs: [] };
  const queue = Array.isArray(returningRows[0])
    ? [...(returningRows as unknown[][])]
    : [returningRows as unknown[]];
  const selectQueue = [...selectRows];

  function thenableSelectChain(): any {
    let resolved: Promise<unknown> | null = null;
    const ensure = () => {
      if (!resolved) resolved = Promise.resolve(selectQueue.shift() ?? []);
      return resolved;
    };
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
            ensure().then(onFulfilled, onRejected);
        }
        return () => thenableSelectChain();
      },
    };
    return new Proxy({}, handler);
  }

  return {
    captured,
    db: {
      select: vi.fn(() => thenableSelectChain()),
      insert: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn((setArg: unknown) => {
          captured.setArg = setArg;
          captured.setArgs.push(setArg);
          return {
            where: vi.fn((whereArg: unknown) => {
              captured.whereArg = whereArg;
              captured.whereArgs.push(whereArg);
              return {
                returning: vi.fn().mockResolvedValue(queue.shift() ?? []),
              };
            }),
          };
        }),
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  relayMocks.disableRingDmButtons.mockResolvedValue(undefined);
  relayMocks.hangUpAndNotify.mockResolvedValue(undefined);
  relayMocks.sendVoicemailBeep.mockResolvedValue(undefined);
});

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
    const { db, captured } = buildDb([[], swept]);

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
    const { db, captured } = buildDb([[], []]);

    await expireRingingCalls(db as any, { now });

    // PhoneService.expireRingingCalls filters on:
    //   and(eq(phoneCalls.status, 'ringing'), isNotNull(phoneCalls.ringExpiresAt), lt(phoneCalls.ringExpiresAt, now))
    // Typed helpers (lt/isNotNull) emit pg-typed parameters; the previous raw `sql\`...\${now}\``
    // template handed the Date to postgres-js without a type cast and crashed every worker tick.
    const expectedWhere = and(
      eq(phoneCalls.status, 'ringing'),
      eq(phoneCalls.voicemailEnabled, false),
      isNotNull(phoneCalls.ringExpiresAt),
      lt(phoneCalls.ringExpiresAt, now),
    );
    expect(captured.whereArg).toEqual(expectedWhere);

    // Belt-and-braces: walk the predicate's chunks (cycle-safe — Drizzle column objects
    // self-reference their table) and confirm it literally carries the 'ringing' value and
    // the ring_expires_at column, and was NOT broadened to also sweep 'active' calls.
    const strings = collectStrings(captured.whereArg);
    expect(strings).toContain('ringing');
    expect(strings.some((s) => s.includes('ring_expires_at'))).toBe(true);
    expect(strings).not.toContain('active');
  });

  it('returns empty list when no calls expired', async () => {
    const { db } = buildDb([[], []]);
    const { expired } = await expireRingingCalls(db as any, {});
    expect(expired).toEqual([]);
  });

  it('does not attempt fan-out notifications when no client is provided', async () => {
    const { db } = buildDb([[], [{ id: 'call-1' }]]);
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

describe('processPendingVoicemailBeeps', () => {
  it('sends the peep, stamps the voicemail, and disables stale ring buttons', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const client = {} as any;
    const pending = [{ id: 'call-1', status: 'voicemail', voicemailBeepedAt: null }];
    const { db, captured } = buildDb([
      [{ id: 'call-1', status: 'voicemail', voicemailPeepClaimedAt: now }],
      [{ id: 'call-1', status: 'voicemail', voicemailBeepedAt: now }],
    ], [pending]);

    const { processed } = await processPendingVoicemailBeeps(db as any, { now, client });

    expect(processed).toEqual(pending);
    expect(relayMocks.sendVoicemailBeep).toHaveBeenCalledWith(client, 'call-1');
    expect(captured.setArgs).toContainEqual({ voicemailBeepedAt: now });
    expect(relayMocks.disableRingDmButtons).toHaveBeenCalledWith(
      client,
      'call-1',
      'The caller was sent to voicemail.',
    );
  });

  it('ends the voicemail and disables ring buttons when the peep cannot be delivered', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const client = {} as any;
    const logger = { error: vi.fn() };
    const pending = [{ id: 'call-1', status: 'voicemail', voicemailBeepedAt: null }];
    const { db, captured } = buildDb([
      [{ id: 'call-1', status: 'voicemail', voicemailPeepClaimedAt: now }],
      [{ id: 'call-1', status: 'ended', endedReason: 'dm_closed' }],
    ], [pending]);
    relayMocks.sendVoicemailBeep.mockRejectedValueOnce(new Error('dm closed'));

    const { processed } = await processPendingVoicemailBeeps(db as any, { now, client, logger });

    expect(processed).toEqual(pending);
    expect(captured.setArgs).toContainEqual(
      expect.objectContaining({ status: 'ended', endedReason: 'dm_closed' }),
    );
    expect(relayMocks.disableRingDmButtons).toHaveBeenCalledWith(
      client,
      'call-1',
      'The caller could not be reached via DM.',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('sweepClaimedVoicemailBeeps', () => {
  it('recovers stale claimed peeps without sending the peep again', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const client = {} as any;
    const recovered = [{ id: 'call-1', status: 'voicemail', voicemailBeepedAt: now }];
    const { db, captured } = buildDb(recovered);

    const result = await sweepClaimedVoicemailBeeps(db as any, { now, maxAgeMs: 1000, client });

    expect(result.recovered).toEqual(recovered);
    expect(captured.setArg).toEqual({ voicemailBeepedAt: now });
    expect(relayMocks.sendVoicemailBeep).not.toHaveBeenCalled();
    expect(relayMocks.disableRingDmButtons).toHaveBeenCalledWith(
      client,
      'call-1',
      'The caller was sent to voicemail.',
    );
  });
});

describe('sweepAbandonedVoicemails', () => {
  it('ends peeped voicemail sessions that timed out waiting for a message', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const client = {} as any;
    const ended = [{ id: 'call-1', status: 'ended', endedReason: 'voicemail_abandoned' }];
    const { db, captured } = buildDb(ended);

    const result = await sweepAbandonedVoicemails(db as any, { now, maxAgeMs: 1000, client });

    expect(result.ended).toEqual(ended);
    expect(captured.setArg).toEqual(
      expect.objectContaining({ status: 'ended', endedReason: 'voicemail_abandoned' }),
    );
    expect(relayMocks.hangUpAndNotify).toHaveBeenCalledWith(client, 'call-1', 'voicemail_abandoned');
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

describe('sweepStaleTapDeliveries', () => {
  it('returns the swept placeholder rows and marks them with an error', async () => {
    const { sweepStaleTapDeliveries } = await import('./phoneRingTimeout.js');
    const swept = [{ id: 'delivery-1', error: 'relay crashed before delivery' }];
    const { db, captured } = buildDb(swept);
    const { swept: result } = await sweepStaleTapDeliveries(db as any, { maxAgeMs: 1000 });
    expect(result).toEqual(swept);
    expect(captured.setArg).toEqual({ error: 'relay crashed before delivery' });
    // The sweep must only touch placeholders that are still pending — `delivered_at` AND
    // `error` both NULL — so a row a concurrent relay completes mid-sweep is left alone.
    // Two `isNull(...)` clauses emit two ` is null` SQL chunks; `created_at < cutoff` bounds it.
    const predicate = collectStrings(captured.whereArg);
    expect(predicate.filter((s) => s.includes('is null'))).toHaveLength(2);
    // lt(phoneMessageTapDeliveries.createdAt, cutoff) puts the column reference and a ` < `
    // operator chunk into the predicate. With typed helpers Drizzle dumps all column
    // metadata into the collected strings, so the column name and operator chunk aren't
    // adjacent — just assert both are present.
    expect(predicate).toContain('created_at');
    expect(predicate.some((s) => s.includes('<'))).toBe(true);
  });

  it('swallows errors and returns an empty result', async () => {
    const { sweepStaleTapDeliveries } = await import('./phoneRingTimeout.js');
    const db = {
      update: vi.fn(() => {
        throw new Error('db down');
      }),
    };
    const logger = { error: vi.fn(), log: vi.fn() };
    const { swept } = await sweepStaleTapDeliveries(db as any, { logger });
    expect(swept).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});
