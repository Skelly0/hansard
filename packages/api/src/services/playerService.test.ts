import { describe, it, expect, vi } from 'vitest';
import { findOrCreatePlayerByDiscordId, aggregatePermissionsForPlayer, listPlayers } from './playerService';

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
  it('passes search to the where clause', async () => {
    // Real chain in playerService.ts: from → where → orderBy → limit → offset
    const offset = vi.fn().mockResolvedValue([{
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
    }]);
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
});
