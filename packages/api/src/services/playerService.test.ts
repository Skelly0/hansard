import { describe, it, expect, vi } from 'vitest';
import { findOrCreatePlayerByDiscordId } from './playerService';

// Mock drizzle db: handles
//   - .select().from().where().limit() (returns existing or empty)
//   - .insert(players).values().onConflictDoUpdate().returning() (returns inserted)
//   - .insert(playerEventLog).values() (returns undefined, can throw)
// `insert` is called twice in the create path; the mock dispatches by call index.
function makeMockDb(existingPlayer: any | null, insertedPlayer: any) {
  const limit = vi.fn().mockResolvedValue(existingPlayer ? [existingPlayer] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const playersInsertChain = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertedPlayer]),
      }),
    }),
  };
  const eventLogInsertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };

  // First insert call (players) returns the players chain;
  // second insert call (playerEventLog) returns the eventLog chain.
  const insert = vi.fn()
    .mockReturnValueOnce(playersInsertChain)
    .mockReturnValueOnce(eventLogInsertChain);

  return { select, insert };
}

describe('findOrCreatePlayerByDiscordId', () => {
  it('returns existing player without creating when found', async () => {
    const existing = { id: 'uuid-1', discordId: '123', discordUsername: 'alice', isStaff: false };
    const db: any = makeMockDb(existing, null);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '123', discordUsername: 'alice' });
    expect(result.player).toEqual(existing);
    expect(result.wasCreated).toBe(false);
  });

  it('creates a new player when none exists', async () => {
    const inserted = { id: 'uuid-new', discordId: '999', discordUsername: 'bob', isStaff: false, isActive: true };
    const db: any = makeMockDb(null, inserted);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '999', discordUsername: 'bob' });
    expect(result.player).toEqual(inserted);
    expect(result.wasCreated).toBe(true);
  });
});
