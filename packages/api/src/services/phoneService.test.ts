import { describe, expect, it } from 'vitest';
import {
  normalizePhoneNumber,
  isValidPhoneNumber,
  PHONE_NUMBER_REGEX,
} from '@hansard/shared';
import { PhoneService, PhoneServiceError } from './phoneService.js';

describe('phone number normalization', () => {
  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizePhoneNumber('(555) 014-2200')).toBe('5550142200');
  });

  it('preserves a leading + on international numbers', () => {
    expect(normalizePhoneNumber('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('rejects empty strings and unicode-only input', () => {
    expect(isValidPhoneNumber('')).toBe(false);
    expect(isValidPhoneNumber('☎️📞')).toBe(false);
  });

  it('accepts short roleplay-friendly numbers like 911', () => {
    expect(isValidPhoneNumber('911')).toBe(true);
    expect(isValidPhoneNumber('42')).toBe(false); // 2 digits — below minimum
  });

  it('rejects pathologically long input', () => {
    expect(isValidPhoneNumber('1'.repeat(21))).toBe(false);
    expect(isValidPhoneNumber('1'.repeat(20))).toBe(true);
  });

  it('regex anchors both ends so injection-style suffixes are rejected', () => {
    expect(PHONE_NUMBER_REGEX.test('555\nDROP TABLE')).toBe(false);
  });
});

// ----- service behaviour ------------------------------------

function makeDb(plan: {
  selectQueues?: unknown[][];
  insertReturning?: unknown[];
  insertErrors?: (Error | undefined)[];
  updateReturning?: unknown[];
  transactionCalls?: { count: number };
  chainEvents?: { method: string; args: unknown[] }[];
}) {
  const selectQueues = [...(plan.selectQueues ?? [])];
  const insertReturning = [...(plan.insertReturning ?? [])];
  const insertErrors = [...(plan.insertErrors ?? [])];
  const updateReturning = [...(plan.updateReturning ?? [])];
  const transactionCalls = plan.transactionCalls;
  const chainEvents = plan.chainEvents;

  // Each chain step returns a Proxy that:
  //   - is awaitable (resolves to the next selectQueue entry)
  //   - returns itself for any further chain call (.where, .limit, .orderBy, etc.)
  function thenableChain(): any {
    let resolved: Promise<unknown> | null = null;
    const ensure = () => {
      if (!resolved) resolved = Promise.resolve(selectQueues.shift() ?? []);
      return resolved;
    };
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
            ensure().then(onFulfilled, onRejected);
        }
        if (prop === 'catch') {
          return (onRejected: (r: unknown) => unknown) => ensure().catch(onRejected);
        }
        if (prop === 'finally') {
          return (onFinally: () => void) => ensure().finally(onFinally);
        }
        return (...args: unknown[]) => {
          if (typeof prop === 'string') {
            chainEvents?.push({ method: prop, args });
          }
          return thenableChain();
        };
      },
    };
    return new Proxy({}, handler);
  }

  const insert = (_table?: unknown) => ({
    values: (_v: unknown) => {
      const err = insertErrors.shift();
      if (err) {
        // Both `.returning()` and a bare await should reject.
        return {
          returning: () => Promise.reject(err),
          then: (_r: any, j: any) => Promise.reject(err).catch(j),
        };
      }
      const rows = insertReturning.shift() ?? [];
      return {
        returning: () => Promise.resolve(rows),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };
    },
  });

  const update = (_table?: unknown) => ({
    set: (_v: unknown) => ({
      where: (_w: unknown) => {
        const rows = updateReturning.shift() ?? [];
        return {
          returning: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        };
      },
    }),
  });

  const select = (_proj?: unknown) => thenableChain();

  const remove = (_table?: unknown) => ({
    where: (_w: unknown) => Promise.resolve(undefined),
  });

  // db.transaction((tx) => fn(tx)) — pass the same fake db back as `tx`.
  const transaction = async (fn: (tx: unknown) => unknown) => {
    if (transactionCalls) transactionCalls.count++;
    return fn(api);
  };

  const api = { select, insert, update, delete: remove, transaction };
  return api as any;
}

describe('PhoneService.registerNumber', () => {
  it('rejects an invalid phone number with a stable error code', async () => {
    const db = makeDb({});
    const svc = new PhoneService(db);
    await expect(svc.registerNumber({ playerId: 'p1', numberRaw: 'abc' })).rejects.toMatchObject({
      code: 'invalid_number',
    });
  });

  it('refuses an unnamed (OAuth placeholder) player', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'p1', characterName: null, isAlive: true }], // player lookup
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.registerNumber({ playerId: 'p1', numberRaw: '5550142' })).rejects.toMatchObject({
      code: 'no_character',
    });
  });

  it('refuses a dead character', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'p1', characterName: 'Alice', isAlive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.registerNumber({ playerId: 'p1', numberRaw: '5550142' })).rejects.toMatchObject({
      code: 'dead',
    });
  });

  it('enforces the per-player active number limit', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'p1', characterName: 'Alice', isAlive: true }],
        [{ value: 5 }], // count() — at limit
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.registerNumber({ playerId: 'p1', numberRaw: '5550142' })).rejects.toMatchObject({
      code: 'limit_reached',
    });
  });

  it('maps Postgres 23505 unique violations to number_taken', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'p1', characterName: 'Alice', isAlive: true }],
        [{ value: 0 }],
      ],
      insertErrors: [Object.assign(new Error('dup'), { code: '23505' })],
    });
    const svc = new PhoneService(db);
    await expect(svc.registerNumber({ playerId: 'p1', numberRaw: '5550142' })).rejects.toMatchObject({
      code: 'number_taken',
    });
  });

  it('strips control/format characters from numberRaw before storing (M7)', async () => {
    // M7: numberRaw is rendered verbatim in DMs/embeds — a player must not be able to smuggle
    // zero-width joiners, bidi marks, or decoration into it.
    const inserted: Record<string, unknown>[] = [];
    const db: any = {
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
      execute: async () => undefined,
      select: () => {
        let resolved: Promise<unknown> | null = null;
        const queue: unknown[][] = [
          [{ id: 'p1', characterName: 'Alice', isAlive: true }],
          [{ value: 0 }],
        ];
        const ensure = () => (resolved ??= Promise.resolve(queue.shift() ?? []));
        const handler: ProxyHandler<object> = {
          get(_t, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => ensure().then(ok, err);
            }
            return () => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { returning: () => Promise.resolve([{ id: 'num-1', ...v }]) };
        },
      }),
    };
    const svc = new PhoneService(db);
    // Zero-width joiner (U+200D) and a left-to-right mark (U+200E) embedded in the raw input.
    await svc.registerNumber({ playerId: 'p1', numberRaw: '+1 (555)‍-0142‎' });
    expect(inserted[0].numberRaw).toBe('+1 (555)-0142');
  });
});

describe('PhoneService.listDirectory', () => {
  it('returns active phone directory rows with character owners', async () => {
    const db = makeDb({
      selectQueues: [[
        {
          id: 'n1',
          playerId: 'p1',
          numberRaw: '555-0101',
          numberNormalized: '5550101',
          label: 'Office',
          characterName: 'Ada Vance',
          discordUsername: 'ada',
        },
        {
          id: 'n2',
          playerId: 'p2',
          numberRaw: '555-0102',
          numberNormalized: '5550102',
          label: null,
          characterName: 'Bram Pike',
          discordUsername: 'bram',
        },
      ]],
    });

    const svc = new PhoneService(db);
    const rows = await svc.listDirectory();

    expect(rows).toEqual([
      expect.objectContaining({
        numberRaw: '555-0101',
        label: 'Office',
        characterName: 'Ada Vance',
      }),
      expect.objectContaining({
        numberRaw: '555-0102',
        label: null,
        characterName: 'Bram Pike',
      }),
    ]);
  });
});

describe('PhoneService.initiateCall', () => {
  it('refuses dead callers', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }], // caller number
        [{ id: 'n2', playerId: 'p2', isActive: true }], // recipient number
        [{ id: 'p1', characterName: 'Alice', discordId: '1', isAlive: false }], // caller player
        [{ id: 'p2', characterName: 'Bob', discordId: '2', isAlive: true }],    // recipient player
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'dead' });
  });

  it('refuses dead recipients with the canonical reason', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }],
        [{ id: 'n2', playerId: 'p2', isActive: true }],
        [{ id: 'p1', characterName: 'Alice', discordId: '1', isAlive: true }],
        [{ id: 'p2', characterName: 'Bob', discordId: '2', isAlive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'recipient_dead' });
  });

  it('refuses self-calls', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }],
        [{ id: 'n2', playerId: 'p1', isActive: true }], // same owner
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'self_call' });
  });

  it('translates partial unique index 23505 into already_on_call', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }],
        [{ id: 'n2', playerId: 'p2', isActive: true }],
        [{ id: 'p1', characterName: 'Alice', discordId: '1', isAlive: true }],
        [{ id: 'p2', characterName: 'Bob', discordId: '2', isAlive: true }],
        [], // caller-side open call check
        [], // recipient-side open call check
      ],
      insertErrors: [Object.assign(new Error('dup'), { code: '23505' })],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'already_on_call' });
  });

  it('refuses cross-role collisions before inserting a new open call', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }],
        [{ id: 'n2', playerId: 'p2', isActive: true }],
        [{ id: 'p1', characterName: 'Alice', discordId: '1', isAlive: true }],
        [{ id: 'p2', characterName: 'Bob', discordId: '2', isAlive: true }],
        [{ id: 'existing-call', callerPlayerId: 'p3', recipientPlayerId: 'p1', status: 'active' }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'already_on_call' });
  });

  it('refuses dials whose recipient is on another call with a busy reason (not "hang up first")', async () => {
    // Regression: previously a recipient already on another call surfaced as
    // `PHONE_ALREADY_ON_CALL` ("Hang up first with /phone hangup") to the dialer, who then
    // ran /phone hangup and was told "You are not currently in a call" — a confusing no-op
    // loop. The dialer should see a distinct "line is busy" message instead.
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', playerId: 'p1', isActive: true }],
        [{ id: 'n2', playerId: 'p2', isActive: true }],
        [{ id: 'p1', characterName: 'Alice', discordId: '1', isAlive: true }],
        [{ id: 'p2', characterName: 'Bob', discordId: '2', isAlive: true }],
        [], // caller-side open call check — clean
        [{ id: 'existing-call', callerPlayerId: 'p2', recipientPlayerId: 'p3', status: 'active' }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'recipient_busy' });
  });
});

describe('PhoneService.recordMessage', () => {
  it('refuses messages on a non-active call', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'ringing',
          callerPlayerId: 'p1',
          recipientPlayerId: 'p2',
        }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p1', content: 'hi' }))
      .rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refuses senders not in the call', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'active', callerPlayerId: 'p1', recipientPlayerId: 'p2' }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p3', content: 'hi' }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses messages from a sender who has since died', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'active', callerPlayerId: 'p1', recipientPlayerId: 'p2' }],
        [{ isAlive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p1', content: 'hi' }))
      .rejects.toMatchObject({ code: 'dead' });
  });

  it('runs the status check + insert inside db.transaction (FOR UPDATE locks the call row)', async () => {
    // The transactional wrapping is what closes the recordMessage / concurrent endCall race.
    // Without it, a status check that wins the read could insert into a call that another
    // hand has already marked `ended`. We assert the txn boundary directly.
    const txCounter = { count: 0 };
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'active', callerPlayerId: 'p1', recipientPlayerId: 'p2', callerNumberId: 'n1', recipientNumberId: 'n2' }],
        [{ isAlive: true }],
        [], // active-taps snapshot — no taps
      ],
      insertReturning: [
        [{ id: 'm1', callId: 'call-1', senderPlayerId: 'p1', content: 'hi' }],
      ],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    const result = await svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p1', content: 'hi' });
    expect(txCounter.count).toBe(1);
    expect(result.message.id).toBe('m1');
    expect(result.tapDeliveries).toEqual([]);
  });

  it('locks the sender row while re-checking liveness before inserting', async () => {
    const chainEvents: { method: string; args: unknown[] }[] = [];
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'active', callerPlayerId: 'p1', recipientPlayerId: 'p2', callerNumberId: 'n1', recipientNumberId: 'n2' }],
        [{ isAlive: true }],
        [],
      ],
      insertReturning: [
        [{ id: 'm1', callId: 'call-1', senderPlayerId: 'p1', content: 'hi' }],
      ],
      chainEvents,
    });
    const svc = new PhoneService(db);
    await svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p1', content: 'hi' });
    const updateLocks = chainEvents.filter((event) => event.method === 'for' && event.args[0] === 'update');
    expect(updateLocks).toHaveLength(2);
  });

  it('pre-creates a placeholder tap-delivery row per active tap inside the message transaction (H1)', async () => {
    // H1: the delivery rows must exist the moment the message commits — not after the relay
    // posts to Discord — so a relay crash can't strand an active tap with no delivery row.
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'active', callerPlayerId: 'p1', recipientPlayerId: 'p2', callerNumberId: 'n1', recipientNumberId: 'n2' }],
        [{ isAlive: true }],
        [{ id: 'tap-1', targetNumberId: 'n1', isActive: true }], // active-taps snapshot
      ],
      insertReturning: [
        [{ id: 'm1', callId: 'call-1', senderPlayerId: 'p1', content: 'hi' }], // phoneMessages
        [{ id: 'delivery-1', messageId: 'm1', tapId: 'tap-1' }],               // placeholder deliveries
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.recordMessage({ callId: 'call-1', senderPlayerId: 'p1', content: 'hi' });
    expect(result.message.id).toBe('m1');
    expect(result.tapDeliveries).toHaveLength(1);
    expect(result.tapDeliveries[0].id).toBe('delivery-1');
  });
});

describe('PhoneService.completeTapDelivery', () => {
  it('updates the placeholder row with the Discord send result rather than inserting a new one', async () => {
    // H1 follow-up: the relay fills in the pre-created placeholder via completeTapDelivery,
    // keyed on the delivery row id, so a retry is idempotent against the same row.
    let updateCalled = false;
    const db = {
      update: () => {
        updateCalled = true;
        return { set: () => ({ where: () => Promise.resolve(undefined) }) };
      },
    } as any;
    const svc = new PhoneService(db);
    await svc.completeTapDelivery('delivery-1', { mirrorMessageId: 'mirror-1' });
    expect(updateCalled).toBe(true);
  });
});

describe('PhoneService.getCallHistory', () => {
  it('refuses non-staff viewing another player\'s history', async () => {
    const db = makeDb({});
    const svc = new PhoneService(db);
    await expect(svc.getCallHistory('p2', { userId: 'p1', isStaff: false }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows staff to view anyone\'s history', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1' }],
        [{ value: 1 }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.getCallHistory('p2', { userId: 'staff-1', isStaff: true });
    expect(result.total).toBe(1);
  });
});

describe('PhoneService tap controls', () => {
  it('refuses non-staff from setting a tap', async () => {
    const svc = new PhoneService(makeDb({}));
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'p1' },
        { userId: 'p1', isStaff: false },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses non-staff from listing taps', async () => {
    const svc = new PhoneService(makeDb({}));
    await expect(svc.listTaps({ userId: 'p1', isStaff: false }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('PhoneServiceError shape', () => {
  it('carries the code on the error instance for caller routing', () => {
    const err = new PhoneServiceError('forbidden', 'nope');
    expect(err.code).toBe('forbidden');
    expect(err.name).toBe('PhoneServiceError');
  });

  it('has no dead `not_in_call` code member (L6)', () => {
    // L6: `not_in_call` was in the union with no code path throwing it. The TS union is
    // compile-time only, so assert via a representative real code instead — this test exists
    // mainly as a tripwire/comment for a future contributor re-adding the dead member.
    const reachableCodes = ['invalid_state', 'forbidden', 'not_found', 'dead'];
    for (const code of reachableCodes) {
      expect(new PhoneServiceError(code as never, 'x').code).toBe(code);
    }
  });
});

describe('PhoneService.findOrCreateThread', () => {
  it('returns the existing row without calling createThread when a thread already exists (H5)', async () => {
    let createCalled = false;
    const txCounter = { count: 0 };
    const db = makeDb({
      selectQueues: [
        [{ id: 't1', playerAId: 'a', playerBId: 'b', discordThreadId: 'D1' }],
      ],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    const result = await svc.findOrCreateThread('b', 'a', {
      createThread: async () => {
        createCalled = true;
        return 'D-new';
      },
    });
    expect(createCalled).toBe(false);
    expect(result.created).toBe(false);
    expect(result.thread?.discordThreadId).toBe('D1');
    expect(txCounter.count).toBe(1);
  });

  it('replaces a stale persisted Discord thread row when the relay reports the thread is gone', async () => {
    let createCalled = false;
    const db = makeDb({
      selectQueues: [
        [{ id: 't1', playerAId: 'a', playerBId: 'b', discordThreadId: 'D-stale' }],
      ],
      insertReturning: [
        [{ id: 't2', playerAId: 'a', playerBId: 'b', discordThreadId: 'D-new' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOrCreateThread('a', 'b', {
      replaceThreadId: 'D-stale',
      createThread: async () => {
        createCalled = true;
        return 'D-new';
      },
    } as never);
    expect(createCalled).toBe(true);
    expect(result.created).toBe(true);
    expect(result.thread?.discordThreadId).toBe('D-new');
  });

  it('creates + persists a thread when none exists (H5)', async () => {
    const db = makeDb({
      selectQueues: [
        [], // no existing row
      ],
      insertReturning: [
        [{ id: 't2', playerAId: 'a', playerBId: 'b', discordThreadId: 'D2' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOrCreateThread('a', 'b', {
      createThread: async () => 'D2',
    });
    expect(result.created).toBe(true);
    expect(result.thread?.discordThreadId).toBe('D2');
  });

  it('deletes the orphaned Discord thread and returns the winning row on a persist-race unique violation (H5)', async () => {
    let orphanDeleted: string | null = null;
    const db = makeDb({
      selectQueues: [
        [], // no existing row at first check
        [{ id: 't3', playerAId: 'a', playerBId: 'b', discordThreadId: 'D-winner' }], // post-violation re-read
      ],
      insertErrors: [Object.assign(new Error('dup'), { code: '23505' })],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOrCreateThread('a', 'b', {
      createThread: async () => 'D-loser',
      onOrphan: async (id) => {
        orphanDeleted = id;
      },
    });
    expect(orphanDeleted).toBe('D-loser');
    expect(result.created).toBe(false);
    expect(result.thread?.discordThreadId).toBe('D-winner');
  });
});

describe('PhoneService.endCall reason derivation', () => {
  it('derives `cancelled_by_caller` when the caller hangs up a still-ringing call', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'ringing',
          callerPlayerId: 'caller',
          recipientPlayerId: 'recipient',
        }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'ended', endedReason: 'cancelled_by_caller' }]],
    });
    const svc = new PhoneService(db);
    const result = await svc.endCall('call-1', 'caller');
    expect(result.endedReason).toBe('cancelled_by_caller');
  });

  it('derives `hangup_recipient` when the recipient ends an active call (no actor spoofing)', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'active',
          callerPlayerId: 'caller',
          recipientPlayerId: 'recipient',
        }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'ended', endedReason: 'hangup_recipient' }]],
    });
    const svc = new PhoneService(db);
    const result = await svc.endCall('call-1', 'recipient');
    expect(result.endedReason).toBe('hangup_recipient');
  });

  it('routes recipient hangup on a still-ringing call to `declined_by_recipient` (matches Decline button)', async () => {
    // Audit consistency: `/phone hangup` from the recipient during ringing must produce the
    // same `(status, endedReason)` pair as clicking the Decline button.
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'ringing',
          callerPlayerId: 'caller',
          recipientPlayerId: 'recipient',
        }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'declined', endedReason: 'declined_by_recipient' }]],
    });
    const svc = new PhoneService(db);
    const result = await svc.endCall('call-1', 'recipient');
    expect(result.endedReason).toBe('declined_by_recipient');
    expect(result.status).toBe('declined');
  });

  it('refuses non-participants from ending the call', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'active',
          callerPlayerId: 'caller',
          recipientPlayerId: 'recipient',
        }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.endCall('call-1', 'stranger')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('PhoneService.forceEndCall', () => {
  it('persists the staff actor on force_ended_by_id so the audit trail is queryable', async () => {
    // M1: rogue-staff threat model — the actor must survive on a structured column, not
    // just embedded in the reason string. Verify both that the update succeeds and that
    // the audit column is populated.
    const captured: Record<string, unknown>[] = [];
    const db = {
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
      select: () => {
        // Single call — return the active call once.
        let resolved: Promise<unknown> | null = null;
        const queue = [[{ id: 'call-1', status: 'active', callerPlayerId: 'c', recipientPlayerId: 'r' }]];
        const ensure = () => (resolved ??= Promise.resolve(queue.shift() ?? []));
        const handler: ProxyHandler<object> = {
          get(_t, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => ensure().then(ok, err);
            }
            return () => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: 'call-1', status: 'ended', endedReason: 'force_ended_by_staff:test', forceEndedById: 'staff-uuid' }]),
            }),
          };
        },
      }),
    } as any;
    const svc = new PhoneService(db);
    const result = await svc.forceEndCall('call-1', 'staff-uuid', { userId: 'staff-uuid', isStaff: true }, 'test');
    expect(result.forceEndedById).toBe('staff-uuid');
    // The persisted update payload must include the actor.
    expect(captured[0]).toMatchObject({ forceEndedById: 'staff-uuid', status: 'ended' });
  });

  it('refuses a non-staff viewer at the service boundary (M1)', async () => {
    // M1: forceEndCall previously trusted the actingStaffId param with no check. It now
    // takes a PhoneViewer and refuses non-staff before touching the call.
    const svc = new PhoneService(makeDb({}));
    await expect(
      svc.forceEndCall('call-1', 'not-staff', { userId: 'not-staff', isStaff: false }, 'test'),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('preserves up to 59 chars of the reason note (column budget after `force_ended_by_staff:` prefix)', async () => {
    // N4: previous slice(0, 48) truncated unnecessarily; the column is varchar(80) and the
    // prefix is 21 chars, so 59 is the safe maximum.
    const captured: Record<string, unknown>[] = [];
    const longNote = 'x'.repeat(64);
    const db = {
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
      select: () => {
        let resolved: Promise<unknown> | null = null;
        const queue = [[{ id: 'call-1', status: 'active', callerPlayerId: 'c', recipientPlayerId: 'r' }]];
        const ensure = () => (resolved ??= Promise.resolve(queue.shift() ?? []));
        const handler: ProxyHandler<object> = {
          get(_t, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => ensure().then(ok, err);
            }
            return () => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: 'call-1' }]),
            }),
          };
        },
      }),
    } as any;
    const svc = new PhoneService(db);
    await svc.forceEndCall('call-1', 'staff-uuid', { userId: 'staff-uuid', isStaff: true }, longNote);
    expect(captured[0].endedReason).toBe(`force_ended_by_staff:${'x'.repeat(59)}`);
  });
});

describe('PhoneService.isTapActive', () => {
  it('returns true when the tap row reports is_active=true', async () => {
    const db = makeDb({
      selectQueues: [[{ isActive: true }]],
    });
    const svc = new PhoneService(db);
    expect(await svc.isTapActive('tap-1')).toBe(true);
  });

  it('returns false when the tap row reports is_active=false (revoked between snapshot and delivery)', async () => {
    const db = makeDb({
      selectQueues: [[{ isActive: false }]],
    });
    const svc = new PhoneService(db);
    expect(await svc.isTapActive('tap-1')).toBe(false);
  });

  it('returns false when the tap row is missing', async () => {
    const db = makeDb({
      selectQueues: [[]],
    });
    const svc = new PhoneService(db);
    expect(await svc.isTapActive('tap-1')).toBe(false);
  });
});

describe('PhoneService.systemEndCall', () => {
  it('writes `missed` when the reason is ring_timeout', async () => {
    const db = makeDb({
      updateReturning: [[{ id: 'call-1', status: 'missed', endedReason: 'ring_timeout' }]],
    });
    const svc = new PhoneService(db);
    const result = await svc.systemEndCall('call-1', 'ring_timeout');
    expect(result?.status).toBe('missed');
  });

  it('writes `ended` for non-timeout system reasons', async () => {
    const db = makeDb({
      updateReturning: [[{ id: 'call-1', status: 'ended', endedReason: 'dm_closed' }]],
    });
    const svc = new PhoneService(db);
    const result = await svc.systemEndCall('call-1', 'dm_closed');
    expect(result?.status).toBe('ended');
  });
});

describe('PhoneService.answerCall / declineCall isAlive guard', () => {
  it('refuses an answer after ring expiry even if the timeout worker has not swept yet', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'ringing',
          callerPlayerId: 'c',
          recipientPlayerId: 'r',
          ringExpiresAt: new Date(Date.now() - 1_000),
        }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.answerCall('call-1', 'r')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('rejects answering a call when the recipient has since died', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'ringing', callerPlayerId: 'c', recipientPlayerId: 'r' }],
        [{ isAlive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.answerCall('call-1', 'r')).rejects.toMatchObject({ code: 'dead' });
  });

  it('rejects declining a call when the recipient has since died', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'ringing', callerPlayerId: 'c', recipientPlayerId: 'r' }],
        [{ isAlive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(svc.declineCall('call-1', 'r')).rejects.toMatchObject({ code: 'dead' });
  });

  it('refuses a decline after ring expiry even if the timeout worker has not swept yet', async () => {
    const db = makeDb({
      selectQueues: [
        [{
          id: 'call-1',
          status: 'ringing',
          callerPlayerId: 'c',
          recipientPlayerId: 'r',
          ringExpiresAt: new Date(Date.now() - 1_000),
        }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'declined' }]],
    });
    const svc = new PhoneService(db);
    await expect(svc.declineCall('call-1', 'r')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('runs answerCall ring-check + alive-check + state update inside one transaction (M2)', async () => {
    // M2: the FOR UPDATE-locked transaction is what closes the alive-check TOCTOU — a death
    // finalization can no longer land between the alive check and the status UPDATE. Assert
    // the transaction boundary directly.
    const txCounter = { count: 0 };
    const chainEvents: { method: string; args: unknown[] }[] = [];
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'ringing', callerPlayerId: 'c', recipientPlayerId: 'r' }],
        [{ isAlive: true }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'active' }]],
      transactionCalls: txCounter,
      chainEvents,
    });
    const svc = new PhoneService(db);
    const result = await svc.answerCall('call-1', 'r');
    expect(txCounter.count).toBe(1);
    expect(chainEvents.filter((event) => event.method === 'for' && event.args[0] === 'update')).toHaveLength(2);
    expect(result.status).toBe('active');
  });

  it('runs declineCall alive-check + state update inside one transaction (M2)', async () => {
    const txCounter = { count: 0 };
    const chainEvents: { method: string; args: unknown[] }[] = [];
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', status: 'ringing', callerPlayerId: 'c', recipientPlayerId: 'r' }],
        [{ isAlive: true }],
      ],
      updateReturning: [[{ id: 'call-1', status: 'declined' }]],
      transactionCalls: txCounter,
      chainEvents,
    });
    const svc = new PhoneService(db);
    const result = await svc.declineCall('call-1', 'r');
    expect(txCounter.count).toBe(1);
    expect(chainEvents.filter((event) => event.method === 'for' && event.args[0] === 'update')).toHaveLength(2);
    expect(result.status).toBe('declined');
  });
});

describe('PhoneService.deactivateNumber', () => {
  it('refuses to retire a number that is on an open call', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'num-1', playerId: 'p1', isActive: true }], // number lookup
        [{ id: 'call-1' }],                                  // open call exists
      ],
    });
    const svc = new PhoneService(db);
    await expect(
      svc.deactivateNumber('num-1', 'p1', { userId: 'p1', isStaff: false }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('auto-revokes active taps on the number and writes a number_deactivated audit row (M5)', async () => {
    // M5: deactivating a number must auto-revoke its taps in the same transaction — a tap on
    // a retired number silently never fires but still shows live in tap-list. The audit row
    // keeps the rogue-staff chain reconstructible.
    const inserted: unknown[] = [];
    let numberUpdate: Record<string, unknown> | null = null;
    let tapUpdate: Record<string, unknown> | null = null;
    const db: any = {
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
      execute: async () => undefined, // advisory lock no-op
      select: (() => {
        // number lookup → row; open-call lookup → none.
        const queue: unknown[][] = [
          [{ id: 'num-1', playerId: 'p1', isActive: true, numberNormalized: '+15550142' }],
          [],
        ];
        return () => {
          const rows = queue.shift() ?? [];
          const resolved = Promise.resolve(rows);
          const handler: ProxyHandler<object> = {
            get(_t, prop) {
              if (prop === 'then') {
                return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) =>
                  resolved.then(ok, err);
              }
              return () => new Proxy({}, handler);
            },
          };
          return new Proxy({}, handler);
        };
      })(),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            // First update (no .returning() awaited) flips the number; second (.returning())
            // flips the taps and returns them.
            if (!numberUpdate) {
              numberUpdate = values;
              return { then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) };
            }
            tapUpdate = values;
            return {
              returning: () =>
                Promise.resolve([
                  { id: 'tap-1', targetNumberId: 'num-1', mirrorChannelId: 'C1', mirrorDiscordUserId: null },
                ]),
            };
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          inserted.push(v);
          return { then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) };
        },
      }),
    };
    const svc = new PhoneService(db);
    await svc.deactivateNumber('num-1', 'p1', { userId: 'p1', isStaff: false });
    expect(numberUpdate).toMatchObject({ isActive: false });
    expect(tapUpdate).toMatchObject({ isActive: false });
    // One audit insert, carrying the number_deactivated action for the revoked tap.
    expect(inserted).toHaveLength(1);
    const auditValues = inserted[0] as Array<{ action: string; tapId: string }>;
    expect(auditValues[0]).toMatchObject({ action: 'number_deactivated', tapId: 'tap-1' });
  });
});

describe('PhoneService.setTap', () => {
  it('refuses a tap with no mirror destination and no env fallback', async () => {
    delete process.env.PHONE_TAP_CHANNEL_ID;
    const svc = new PhoneService(makeDb({}));
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'staff', reason: null },
        { userId: 'staff', isStaff: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('runs the insert + audit-log writes inside db.transaction', async () => {
    const txCounter = { count: 0 };
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', numberNormalized: '+15550142', isActive: true }], // number lookup
      ],
      insertReturning: [
        [{ id: 'tap-1', targetNumberId: 'n1' }], // phoneTaps insert (returning)
      ],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    await svc.setTap(
      { targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C1' },
      { userId: 'staff', isStaff: true },
    );
    expect(txCounter.count).toBe(1);
  });

  it('refuses a tap on a retired (inactive) number (M3)', async () => {
    // M3: a retired number id still resolves through the FK, but a tap on it would silently
    // never fire — refuse it at the boundary instead of creating a dead tap.
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', numberNormalized: '+15550142', isActive: false }],
      ],
    });
    const svc = new PhoneService(db);
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C1' },
        { userId: 'staff', isStaff: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('re-checks the target number under the setTap transaction lock', async () => {
    let inTransaction = false;
    let insertCalled = false;
    const chain = (rows: unknown[]) => {
      const resolved = Promise.resolve(rows);
      const handler: ProxyHandler<object> = {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => resolved.then(ok, err);
          }
          return () => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    };
    const db: any = {
      transaction: async (fn: (tx: unknown) => unknown) => {
        inTransaction = true;
        try {
          return await fn(db);
        } finally {
          inTransaction = false;
        }
      },
      execute: async () => undefined,
      select: () => chain(inTransaction
        ? [{ id: 'n1', numberNormalized: '+15550142', isActive: false }]
        : [{ id: 'n1', numberNormalized: '+15550142', isActive: true }]),
      insert: () => ({
        values: () => {
          insertCalled = true;
          return { returning: () => Promise.resolve([{ id: 'tap-1', targetNumberId: 'n1' }]) };
        },
      }),
    };
    const svc = new PhoneService(db);
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C1' },
        { userId: 'staff', isStaff: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(insertCalled).toBe(false);
  });

  it('translates a 23505 from the active-target unique index into a friendly already-tapped error (H2)', async () => {
    // H2: `phone_taps_active_target_unique` rejects a second active tap on the same number.
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', numberNormalized: '+15550142', isActive: true }],
      ],
      insertErrors: [Object.assign(new Error('dup'), { code: '23505' })],
    });
    const svc = new PhoneService(db);
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C1' },
        { userId: 'staff', isStaff: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('PhoneService.revokeTap', () => {
  it('wraps the conditional update + audit insert in db.transaction', async () => {
    // M4: the active-state check is now folded into `UPDATE ... WHERE is_active = true
    // RETURNING` inside the transaction — the update returns the tap row, then the number
    // lookup, then the audit insert.
    const txCounter = { count: 0 };
    const db = makeDb({
      updateReturning: [
        [{ id: 'tap-1', isActive: false, targetNumberId: 'n1', mirrorChannelId: 'C1', mirrorDiscordUserId: null }],
      ],
      selectQueues: [
        [{ numberNormalized: '+15550142' }],
      ],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    await svc.revokeTap('tap-1', 'staff', { userId: 'staff', isStaff: true });
    expect(txCounter.count).toBe(1);
  });

  it('refuses (not_found) when the conditional update flips no row — already revoked / race loser (M4)', async () => {
    // M4: two concurrent revokes can no longer both write a `revoked` audit row. The caller
    // whose `UPDATE ... WHERE is_active = true` matches zero rows gets not_found and does not
    // audit.
    const db = makeDb({
      updateReturning: [[]], // no row flipped
    });
    const svc = new PhoneService(db);
    await expect(
      svc.revokeTap('tap-1', 'staff', { userId: 'staff', isStaff: true }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('PhoneService.getCallTranscript', () => {
  it('returns null (not a forbidden throw) for a non-participant — no existence leak (M6)', async () => {
    // M6: returning null for a real-but-private call collapses it with the not-found case,
    // so a non-participant cannot distinguish "this call exists" from "no such call". Mirrors
    // getPlayerVotingRecord.
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', callerPlayerId: 'c', recipientPlayerId: 'r' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.getCallTranscript('call-1', { userId: 'stranger', isStaff: false });
    expect(result).toBeNull();
  });

  it('returns null for a non-existent call too (same shape as the non-participant case)', async () => {
    const db = makeDb({ selectQueues: [[]] });
    const svc = new PhoneService(db);
    const result = await svc.getCallTranscript('missing', { userId: 'anyone', isStaff: false });
    expect(result).toBeNull();
  });

  it('allows a participant to view their own transcript (no taps key in the non-staff shape)', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', callerPlayerId: 'c', recipientPlayerId: 'r' }],
        [{ id: 'm1', content: 'hi' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.getCallTranscript('call-1', { userId: 'c', isStaff: false });
    expect(result?.messages.length).toBeGreaterThan(0);
    // L5: non-staff shape is unchanged — no taps key.
    expect(result && 'taps' in result).toBe(false);
  });

  it('attaches tap-delivery rows for a staff viewer (L5)', async () => {
    // L5: a staff transcript carries `taps` so the wiretap audit trail is reconstructible
    // from one read.
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', callerPlayerId: 'c', recipientPlayerId: 'r' }], // call
        [{ id: 'm1', content: 'hi' }],                                    // messages
        [{ id: 'delivery-1', messageId: 'm1', tapId: 'tap-1' }],          // tap deliveries
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.getCallTranscript('call-1', { userId: 'staff', isStaff: true });
    expect(result?.call.id).toBe('call-1');
    expect(result?.taps).toHaveLength(1);
    expect(result?.taps?.[0].id).toBe('delivery-1');
  });
});

describe('PhoneService.getCallHistory enrichment', () => {
  it('attaches caller/recipient summaries to each history row', async () => {
    const db = makeDb({
      selectQueues: [
        // history rows
        [
          {
            id: 'call-1',
            callerPlayerId: 'p1',
            recipientPlayerId: 'p2',
            callerNumberId: 'n1',
            recipientNumberId: 'n2',
            status: 'ended',
            endedReason: 'hangup_caller',
            startedAt: new Date('2026-05-12T12:00:00Z'),
          },
        ],
        // total count
        [{ value: 1 }],
        // players join
        [
          { id: 'p1', characterName: 'Alice', discordUsername: 'alice#1', discordId: '1' },
          { id: 'p2', characterName: 'Bob', discordUsername: 'bob#1', discordId: '2' },
        ],
        // numbers join
        [
          { id: 'n1', numberRaw: '+1001' },
          { id: 'n2', numberRaw: '+1002' },
        ],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.getCallHistory('p1', { userId: 'p1', isStaff: false });
    expect(result.calls[0].caller.characterName).toBe('Alice');
    expect(result.calls[0].recipient.characterName).toBe('Bob');
    expect(result.calls[0].caller.numberRaw).toBe('+1001');
    expect(result.calls[0].recipient.numberRaw).toBe('+1002');
  });
});

describe('PhoneService.countTrailingTapFailures', () => {
  it('counts only the contiguous leading-failure run from the most recent deliveries', async () => {
    const db = makeDb({
      selectQueues: [
        // Most recent first; consecutive trailing failures = 2.
        [
          { error: 'fail1' },
          { error: 'fail2' },
          { error: null },     // breaks the streak
          { error: 'fail3' },
        ],
      ],
    });
    const svc = new PhoneService(db);
    const count = await svc.countTrailingTapFailures('tap-1', 10);
    expect(count).toBe(2);
  });

  it('returns 0 when the most recent delivery succeeded', async () => {
    const db = makeDb({
      selectQueues: [[{ error: null }, { error: 'old' }]],
    });
    const svc = new PhoneService(db);
    expect(await svc.countTrailingTapFailures('tap-1', 10)).toBe(0);
  });

  it('returns the full window count when every delivery in scope failed', async () => {
    const db = makeDb({
      selectQueues: [[{ error: 'e' }, { error: 'e' }, { error: 'e' }]],
    });
    const svc = new PhoneService(db);
    expect(await svc.countTrailingTapFailures('tap-1', 10)).toBe(3);
  });
});

describe('PhoneService.autoRevokeBrokenTap', () => {
  it('is idempotent — does nothing for already-inactive taps', async () => {
    const txCounter = { count: 0 };
    const db = makeDb({
      updateReturning: [[]],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    await svc.autoRevokeBrokenTap('tap-1', 'circuit-breaker fired');
    expect(txCounter.count).toBe(1);
  });

  it('runs the revoke + audit write in a single transaction with orphaned action', async () => {
    const txCounter = { count: 0 };
    const db = makeDb({
      updateReturning: [
        [{ id: 'tap-1', isActive: false, targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C', mirrorDiscordUserId: null }],
      ],
      selectQueues: [
        [{ numberNormalized: '+15550142' }],
      ],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    await svc.autoRevokeBrokenTap('tap-1', 'too many failures');
    expect(txCounter.count).toBe(1);
  });

  it('does not write an audit row when a concurrent revoke already won', async () => {
    let auditInserts = 0;
    const queue: unknown[][] = [
      [{ id: 'tap-1', isActive: true, targetNumberId: 'n1', createdById: 'staff', mirrorChannelId: 'C', mirrorDiscordUserId: null }],
      [{ numberNormalized: '+15550142' }],
    ];
    const db: any = {
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
      select: () => {
        const rows = queue.shift() ?? [];
        const resolved = Promise.resolve(rows);
        const handler: ProxyHandler<object> = {
          get(_t, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => resolved.then(ok, err);
            }
            return () => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      insert: () => ({
        values: () => {
          auditInserts++;
          return { then: (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok) };
        },
      }),
    };
    const svc = new PhoneService(db);
    await svc.autoRevokeBrokenTap('tap-1', 'too many failures');
    expect(auditInserts).toBe(0);
  });
});

describe('PhoneService.findOpenCallForPlayer two-query path', () => {
  it('returns the caller-side row when player is the caller', async () => {
    const db = makeDb({
      selectQueues: [
        [{ id: 'call-1', callerPlayerId: 'p1', status: 'active' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOpenCallForPlayer('p1');
    expect(result?.id).toBe('call-1');
  });

  it('falls through to the recipient-side lookup when caller-side has no match', async () => {
    const db = makeDb({
      selectQueues: [
        [], // caller-side: no row
        [{ id: 'call-2', recipientPlayerId: 'p1', status: 'ringing' }],
      ],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOpenCallForPlayer('p1');
    expect(result?.id).toBe('call-2');
  });

  it('returns null when neither side matches', async () => {
    const db = makeDb({
      selectQueues: [[], []],
    });
    const svc = new PhoneService(db);
    const result = await svc.findOpenCallForPlayer('p1');
    expect(result).toBeNull();
  });
});

describe('PhoneService.setTap requires a destination', () => {
  it('refuses when channel + user + env are all empty', async () => {
    delete process.env.PHONE_TAP_CHANNEL_ID;
    const svc = new PhoneService(makeDb({}));
    await expect(
      svc.setTap(
        { targetNumberId: 'n1', createdById: 'staff' },
        { userId: 'staff', isStaff: true },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('accepts when only the env fallback is configured', async () => {
    process.env.PHONE_TAP_CHANNEL_ID = '999';
    const txCounter = { count: 0 };
    const db = makeDb({
      selectQueues: [
        [{ id: 'n1', numberNormalized: '+15550142', isActive: true }],
      ],
      insertReturning: [[{ id: 'tap-env', targetNumberId: 'n1' }]],
      transactionCalls: txCounter,
    });
    const svc = new PhoneService(db);
    const tap = await svc.setTap(
      { targetNumberId: 'n1', createdById: 'staff' },
      { userId: 'staff', isStaff: true },
    );
    expect(tap.id).toBe('tap-env');
    delete process.env.PHONE_TAP_CHANNEL_ID;
  });
});

describe('PhoneService.sweepStrandedActiveCalls', () => {
  it('updates active calls older than the configured cutoff', async () => {
    const db = makeDb({
      updateReturning: [
        [
          { id: 'call-1', status: 'ended', endedReason: 'session_reset' },
          { id: 'call-2', status: 'ended', endedReason: 'session_reset' },
        ],
      ],
    });
    const svc = new PhoneService(db);
    const rows = await svc.sweepStrandedActiveCalls({ maxAgeMs: 60_000 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.endedReason === 'session_reset')).toBe(true);
  });
});
