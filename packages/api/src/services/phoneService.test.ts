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
}) {
  const selectQueues = [...(plan.selectQueues ?? [])];
  const insertReturning = [...(plan.insertReturning ?? [])];
  const insertErrors = [...(plan.insertErrors ?? [])];
  const updateReturning = [...(plan.updateReturning ?? [])];

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
        return () => thenableChain();
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

  return { select, insert, update } as any;
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
      ],
      insertErrors: [Object.assign(new Error('dup'), { code: '23505' })],
    });
    const svc = new PhoneService(db);
    await expect(svc.initiateCall({ callerPlayerId: 'p1', callerNumberId: 'n1', recipientNumberId: 'n2' }))
      .rejects.toMatchObject({ code: 'already_on_call' });
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
});
