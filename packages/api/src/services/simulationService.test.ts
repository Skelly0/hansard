import { describe, it, expect, vi, afterEach } from 'vitest';
import { desc } from 'drizzle-orm';
import { simulationClock, timeAdvanceLog, players, playerEventLog, officeHolders, parties } from '@hansard/db';
import { advanceTime, DEFAULT_AGING_CONFIG, getHistory, sanitizeTimeAdvanceLog } from './simulationService';

function makePlayer(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'player-1',
    characterName: 'Ada Mortalis',
    birthDate: '1950-01-01',
    currentAge: 76,
    ailments: [
      { condition: 'cancer', severity: 'major', acquiredAtTick: 0, acquiredAtAge: 75 },
      { condition: 'stroke', severity: 'critical', acquiredAtTick: 0, acquiredAtAge: 76 },
    ],
    profileData: null,
    isAlive: true,
    deathDate: null,
    causeOfDeath: null,
    healthStatus: 'healthy',
    ...overrides,
  };
}

function makeClock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clock-1',
    currentTick: 0,
    currentDate: '2026-01-01',
    tickUnit: 'month',
    isPaused: false,
    agingConfig: {
      ...DEFAULT_AGING_CONFIG,
      ailmentAgeThreshold: 999,
      deathAgeThreshold: 1,
      deathBaseChance: 1,
      deathAgeScaling: 0,
    },
    ...overrides,
  };
}

function makeSimulationDb(clock: any, playerRows: any[]) {
  const eventLog: any[] = [];
  const timeLog: any[] = [];
  const partyUpdates: any[] = [];

  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table === simulationClock) {
          return {
            limit: vi.fn(async (limit: number) => [clock].slice(0, limit)),
          };
        }

        if (table === players) {
          return {
            where: vi.fn(async () => playerRows.filter((player) => player.isAlive)),
          };
        }

        if (table === officeHolders) {
          return {
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => []),
            })),
          };
        }

        return {
          where: vi.fn(async () => []),
          limit: vi.fn(async () => []),
        };
      }),
    })),
    update: vi.fn((table) => ({
      set: vi.fn((values) => ({
        where: vi.fn(async () => {
          if (table === players) {
            Object.assign(playerRows[0], values);
          }
          if (table === simulationClock) {
            Object.assign(clock, values);
          }
          if (table === parties) {
            partyUpdates.push(values);
          }
          return [];
        }),
      })),
    })),
    insert: vi.fn((table) => ({
      values: vi.fn(async (values) => {
        if (table === playerEventLog) eventLog.push(values);
        if (table === timeAdvanceLog) timeLog.push(values);
        return [];
      }),
    })),
    transaction: vi.fn(async (callback) => callback(db)),
  };

  return { db, eventLog, timeLog, partyUpdates };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DEFAULT_AGING_CONFIG ailment pool', () => {
  it('keeps the automatic ailment pool grounded in normal dangerous conditions', () => {
    const pool = DEFAULT_AGING_CONFIG.ailmentPool;
    const names = pool.map((ailment) => ailment.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(pool.length);
    expect(pool.every((ailment) => ailment.weight > 0)).toBe(true);
    expect(names).toEqual(expect.arrayContaining([
      'cancer',
      'heart disease',
      'kidney disease',
      'liver disease',
      'pulmonary fibrosis',
      'chronic obstructive pulmonary disease',
      'dementia',
      "Parkinson's disease",
      'stroke',
      'heart failure',
      'sepsis',
      'pulmonary embolism',
      'ruptured aneurysm',
      'organ failure',
    ]));

    expect(pool.filter((ailment) => ailment.severity === 'minor')).toHaveLength(0);
    expect(pool.filter((ailment) => ailment.severity === 'major')).toHaveLength(8);
    expect(pool.filter((ailment) => ailment.severity === 'critical')).toHaveLength(6);
    expect(pool.some((ailment) => ailment.minAge === 55)).toBe(true);
    expect(pool.some((ailment) => ailment.minAge === 60)).toBe(true);
    expect(pool.some((ailment) => ailment.minAge === 65)).toBe(true);
    expect(pool.some((ailment) => ailment.minAge === 70)).toBe(true);
    expect(pool.filter((ailment) => ailment.severity === 'critical')
      .every((ailment) => (ailment.minAge ?? 0) >= 60)).toBe(true);
  });
});

describe('advanceTime death grace period', () => {
  it('marks an automatic death roll as pending for one advance before processing death', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const clock = makeClock();
    const player = makePlayer();
    const { db, eventLog, partyUpdates } = makeSimulationDb(clock, [player]);

    const firstAdvance = await advanceTime(db, 1, 'staff-1');

    expect(firstAdvance.deathDetails).toEqual([]);
    expect(firstAdvance.pendingDeathDetails).toHaveLength(1);
    expect(firstAdvance.pendingDeathDetails[0]).toMatchObject({
      playerId: 'player-1',
      characterName: 'Ada Mortalis',
      cause: 'natural causes',
      triggeredTick: 1,
      eligibleFromTick: 2,
      ailments: [
        { condition: 'cancer', severity: 'major' },
        { condition: 'stroke', severity: 'critical' },
      ],
    });
    expect(player.isAlive).toBe(true);
    expect(player.deathDate).toBeNull();
    expect(player.profileData?.pendingDeath).toMatchObject({
      cause: 'natural causes',
      triggeredTick: 1,
      triggeredDate: '2026-02-01',
      eligibleFromTick: 2,
      ailments: [
        { condition: 'cancer', severity: 'major' },
        { condition: 'stroke', severity: 'critical' },
      ],
    });
    const pendingDeathEvent = eventLog.find((event) => event.eventType === 'death_pending');
    expect(pendingDeathEvent).toBeTruthy();
    expect(pendingDeathEvent.description).toContain('ailments: cancer (major), stroke (critical)');

    const secondAdvance = await advanceTime(db, 1, 'staff-1');

    expect(secondAdvance.pendingDeathDetails).toEqual([]);
    expect(secondAdvance.deathDetails).toHaveLength(1);
    expect(secondAdvance.deathDetails[0]).toMatchObject({
      playerId: 'player-1',
      characterName: 'Ada Mortalis',
      cause: 'natural causes',
      age: 76,
      ailments: [
        { condition: 'cancer', severity: 'major' },
        { condition: 'stroke', severity: 'critical' },
      ],
    });
    expect(player.isAlive).toBe(false);
    expect(player.deathDate).toBe('2026-03-01');
    expect(player.causeOfDeath).toBe('natural causes');
    const deathEvent = eventLog.find((event) => event.eventType === 'death');
    expect(deathEvent).toBeTruthy();
    expect(deathEvent.description).toContain('ailments: cancer (major), stroke (critical)');
    expect(deathEvent.newValue).toMatchObject({
      ailments: [
        { condition: 'cancer', severity: 'major' },
        { condition: 'stroke', severity: 'critical' },
      ],
    });

    // A dead character must not stay listed as a party leader. The pending-death
    // first pass should not touch parties (player is still alive); the second
    // pass that finalizes death must run the leader cleanup.
    expect(partyUpdates).toEqual([{ leaderId: null }]);
  });
});

describe('simulation history privacy', () => {
  it('redacts per-player event IDs from time advance summaries for non-staff viewers', () => {
    const row = {
      id: 'advance-1',
      notes: 'Private staff context',
      summary: {
        deaths: ['dead-player'],
        pendingDeaths: ['pending-player'],
        ailments: ['ailing-player'],
        aged: 4,
      },
    };

    const result = sanitizeTimeAdvanceLog(row, { isStaff: false });

    expect(result.summary).toEqual({
      deaths: [],
      pendingDeaths: [],
      ailments: [],
      aged: 4,
    });
    expect(result.notes).toBeNull();
  });

  it('keeps raw summaries for staff viewers', () => {
    const row = {
      id: 'advance-1',
      summary: {
        deaths: ['dead-player'],
        pendingDeaths: ['pending-player'],
        ailments: ['ailing-player'],
        aged: 4,
      },
    };

    expect(sanitizeTimeAdvanceLog(row, { isStaff: true })).toBe(row);
  });
});

describe('getHistory ordering', () => {
  it('returns the most recent time advances first', async () => {
    // Three rows seeded with strictly increasing createdAt timestamps;
    // newest-first means the row with the latest createdAt comes first.
    const oldest = {
      id: 'advance-old',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      summary: { aged: 1 },
      notes: null,
    };
    const middle = {
      id: 'advance-mid',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      summary: { aged: 2 },
      notes: null,
    };
    const newest = {
      id: 'advance-new',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      summary: { aged: 3 },
      notes: null,
    };

    const storedRows = [oldest, middle, newest];
    const limitSpy = vi.fn();
    const orderBySpy = vi.fn();

    const db: any = {
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table !== timeAdvanceLog) {
            throw new Error('Unexpected table in getHistory test');
          }
          return {
            orderBy: (orderArg: unknown) => {
              orderBySpy(orderArg);
              return {
                limit: (n: number) => {
                  limitSpy(n);
                  const sortedDesc = [...storedRows].sort(
                    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                  );
                  return Promise.resolve(sortedDesc.slice(0, n));
                },
              };
            },
          };
        }),
      })),
    };

    const result = await getHistory(db, 20, { isStaff: true });

    expect(limitSpy).toHaveBeenCalledWith(20);
    // If the service regresses to `orderBy(timeAdvanceLog.createdAt)` (asc),
    // the orderArg would be the bare column reference — assert it isn't.
    expect(orderBySpy.mock.calls[0][0]).not.toBe(timeAdvanceLog.createdAt);
    expect(orderBySpy.mock.calls[0][0]).toEqual(desc(timeAdvanceLog.createdAt));
    expect(result.map((row: any) => row.id)).toEqual([
      'advance-new',
      'advance-mid',
      'advance-old',
    ]);
  });
});
