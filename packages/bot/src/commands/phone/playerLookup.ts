import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { db } from '../../db.js';

/**
 * Shared phone-system player lookup. Consolidates the previously-duplicated `resolvePlayer`
 * helpers in `phone.ts` and `phoneButtons.ts`. Projects `isAlive` so callers can enforce
 * the "a deceased character cannot place or receive calls" rule without a second query.
 */
export type PhonePlayerRow = {
  id: string;
  characterName: string | null;
  isAlive: boolean;
};

/** Resolve a player row by Discord snowflake, or `null` if no row exists. */
export async function resolvePhonePlayer(discordId: string): Promise<PhonePlayerRow | null> {
  const [row] = await db
    .select({ id: players.id, characterName: players.characterName, isAlive: players.isAlive })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);
  return row ?? null;
}
