import { and, eq } from 'drizzle-orm';
import { parties } from '@hansard/db';
import { db } from '../../db.js';

export async function clearPartyLeaderIfMatches(
  partyId: string | null,
  playerId: string,
): Promise<void> {
  if (!partyId) return;

  await db
    .update(parties)
    .set({ leaderId: null })
    .where(and(
      eq(parties.id, partyId),
      eq(parties.leaderId, playerId),
    ));
}
