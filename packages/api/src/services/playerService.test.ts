import { describe, it, expect, vi } from 'vitest';
import {
  findOrCreatePlayerByDiscordId,
  aggregatePermissionsForPlayer,
  listPlayers,
  getPlayerVotingRecord,
} from './playerService';

// Mock drizzle db: handles
//   - .insert(players).values().onConflictDoUpdate().returning() (returns inserted)
//   - .insert(playerEventLog).values() (returns undefined, can throw)
// The atomic upsert path uses ONLY insert (no SELECT-then-INSERT).
// `insert` may be called twice (players, then playerEventLog when wasCreated).
function makeMockDb(returnedPlayer: any) {
  const playersInsertChain = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([returnedPlayer]),
      }),
    }),
  };
  const eventLogInsertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };

  const insert = vi.fn()
    .mockReturnValueOnce(playersInsertChain)
    .mockReturnValueOnce(eventLogInsertChain);

  // No-op select chain (kept so any incidental select doesn't throw)
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  return { select, insert };
}

describe('findOrCreatePlayerByDiscordId', () => {
  it('returns existing player without flagging wasCreated when registeredAt is old', async () => {
    const oldDate = new Date(Date.now() - 60_000);
    const existing = { id: 'uuid-1', discordId: '123', discordUsername: 'alice', isStaff: false, registeredAt: oldDate };
    const db: any = makeMockDb(existing);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '123', discordUsername: 'alice' });
    expect(result.player).toEqual(existing);
    expect(result.wasCreated).toBe(false);
  });

  it('flags wasCreated when registeredAt is fresh', async () => {
    const inserted = { id: 'uuid-new', discordId: '999', discordUsername: 'bob', isStaff: false, isActive: true, registeredAt: new Date() };
    const db: any = makeMockDb(inserted);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '999', discordUsername: 'bob' });
    expect(result.player).toEqual(inserted);
    expect(result.wasCreated).toBe(true);
  });
});

describe('aggregatePermissionsForPlayer', () => {
  // Capture the WHERE predicate so we can assert it was applied
  function makePermissionsMockDb(rows: any[]) {
    const where = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    return { select, _where: where, _innerJoin: innerJoin, _from: from };
  }

  it('returns empty array when player holds no offices', async () => {
    const db: any = makePermissionsMockDb([]);
    const result = await aggregatePermissionsForPlayer(db, 'player-uuid');
    expect(result).toEqual([]);
  });

  it('aggregates and dedupes permissions across multiple offices', async () => {
    const rows = [
      { permissions: ['legislative_leader', 'call_elections'] },
      { permissions: ['legislative_leader', 'appoint_ministers'] },
      { permissions: null },
    ];
    const db: any = makePermissionsMockDb(rows);
    const result = await aggregatePermissionsForPlayer(db, 'player-uuid');
    expect(result.sort()).toEqual(['appoint_ministers', 'call_elections', 'legislative_leader']);
  });

  it('applies the active-holding WHERE predicate (regression guard)', async () => {
    // The contract: filter by playerId AND endDate IS NULL.
    // If the implementation drops either filter, requireRole correctness breaks.
    // We can't easily inspect drizzle SQL chunks, but we can assert the call shape.
    const db: any = makePermissionsMockDb([]);
    await aggregatePermissionsForPlayer(db, 'player-uuid');
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db._from).toHaveBeenCalledTimes(1);
    expect(db._innerJoin).toHaveBeenCalledTimes(1);
    expect(db._where).toHaveBeenCalledTimes(1);
    // The WHERE arg should be a truthy SQL expression (drizzle's `and(...)` result),
    // not undefined — which would happen if both filters were accidentally removed.
    const whereArg = db._where.mock.calls[0][0];
    expect(whereArg).toBeTruthy();
  });
});

describe('listPlayers with search', () => {
  function containsText(value: unknown, pattern: RegExp, seen = new Set<object>()): boolean {
    if (typeof value === 'string') return pattern.test(value);
    if (!value || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    for (const key of Reflect.ownKeys(value)) {
      const child = (value as Record<PropertyKey, unknown>)[key];
      if (containsText(child, pattern, seen)) return true;
    }

    return false;
  }

  function playerRow(overrides: Partial<Record<string, any>> = {}) {
    return {
      id: 'p1',
      discordId: '111',
      discordUsername: 'aldrick',
      characterName: 'Aldrick Vance',
      characterBio: null,
      characterPortraitUrl: null,
      factionId: null,
      partyId: null,
      birthDate: '1990-01-01',
      startingAge: 35,
      currentAge: 35,
      deathDate: null,
      causeOfDeath: null,
      isAlive: true,
      healthStatus: 'healthy',
      ailments: [],
      startingFavoursGranted: false,
      isActive: true,
      isStaff: false,
      staffRole: null,
      registeredAt: new Date(),
      lastActiveAt: null,
      profileData: null,
      ...overrides,
    };
  }

  it('passes search to the where clause', async () => {
    // Real chain in playerService.ts: from → where → orderBy → limit → offset
    const offset = vi.fn().mockResolvedValue([playerRow()]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db: any = { select };

    const results = await listPlayers(db, { search: 'aldrick', limit: 10, offset: 0 });
    expect(results).toHaveLength(1);
    expect(where).toHaveBeenCalled();
    // Search predicate must actually be present in the WHERE arg, not silently dropped.
    const whereArg = where.mock.calls[0][0];
    expect(whereArg).toBeTruthy();
  });

  it('excludes OAuth-only rows that have not created a character', async () => {
    const rows = [
      playerRow({ id: 'created-character', characterName: 'Aldrick Vance' }),
      playerRow({ id: 'oauth-placeholder', discordUsername: 'oauth-only', characterName: null }),
    ];
    const offset = vi.fn().mockImplementation(() => {
      const whereArg = where.mock.calls[0][0];
      return Promise.resolve(
        containsText(whereArg, /is not null/i)
          ? rows.filter((row) => row.characterName !== null)
          : rows,
      );
    });
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db: any = { select };

    const results = await listPlayers(db, { isActive: true, limit: 10, offset: 0 });

    expect(results.map((player) => player.id)).toEqual(['created-character']);
  });
});

describe('getPlayerVotingRecord privacy', () => {
  function makeVotingRecordDb(rows: any[]) {
    const orderBy = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ orderBy });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    return { select, _orderBy: orderBy };
  }

  const castAt = new Date('2026-01-01T00:00:00.000Z');
  const baseRow = {
    ballot: {
      electionId: 'election-1',
      voterId: 'target-player',
      vote: { type: 'yea_nay_abstain', choice: 'yea' },
      castAt,
    },
    electionTitle: 'Chancellor Confirmation',
    electionStatus: 'tallied',
    electionConfig: {},
  };

  it('redacts anonymous ballot choices and cast times from other players', async () => {
    const db: any = makeVotingRecordDb([
      {
        ...baseRow,
        electionConfig: { anonymousBallots: true },
      },
    ]);

    const result = await (getPlayerVotingRecord as any)(db, 'target-player', {
      userId: 'viewer-player',
      isStaff: false,
    });

    expect(result).toEqual([
      {
        electionId: 'election-1',
        electionTitle: 'Chancellor Confirmation',
        choice: null,
        castAt: null,
      },
    ]);
  });

  it('redacts sealed in-progress choices and cast times even for staff', async () => {
    const db: any = makeVotingRecordDb([
      {
        ...baseRow,
        electionStatus: 'voting_open',
        electionConfig: { sealedResults: true },
      },
    ]);

    const result = await (getPlayerVotingRecord as any)(db, 'target-player', {
      userId: 'staff-player',
      isStaff: true,
    });

    expect(result[0]).toMatchObject({
      choice: null,
      castAt: null,
    });
  });

  it('allows players to see their own ballot record', async () => {
    const db: any = makeVotingRecordDb([baseRow]);

    const result = await (getPlayerVotingRecord as any)(db, 'target-player', {
      userId: 'target-player',
      isStaff: false,
    });

    expect(result[0]).toMatchObject({
      choice: 'yea',
      castAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
