import { describe, expect, it, vi } from 'vitest';

// phoneRingTimeout pulls in phoneRelay which pulls in `../db.js`, which throws at
// import without DATABASE_URL set. Tests don't actually touch the DB.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const { expireRingingCalls } = await import('./phoneRingTimeout.js');

function buildDb(returningRows: unknown[]) {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(returningRows),
        })),
      })),
    })),
  };
}

describe('expireRingingCalls', () => {
  it('marks all overdue ringing calls missed and returns the swept rows', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const swept = [
      { id: 'call-1', status: 'missed', endedReason: 'ring_timeout' },
      { id: 'call-2', status: 'missed', endedReason: 'ring_timeout' },
    ];
    const db = buildDb(swept);

    const { expired } = await expireRingingCalls(db as any, { now });
    expect(expired).toEqual(swept);
  });

  it('returns empty list when no calls expired', async () => {
    const db = buildDb([]);
    const { expired } = await expireRingingCalls(db as any, {});
    expect(expired).toEqual([]);
  });

  it('does not attempt fan-out notifications when no client is provided', async () => {
    const db = buildDb([{ id: 'call-1' }]);
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
    const db = buildDb(swept);
    const { ended } = await sweepStrandedActiveCalls(db as any, { maxAgeMs: 1000 });
    expect(ended).toEqual(swept);
  });
});
