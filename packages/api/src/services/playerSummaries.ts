import { inArray } from 'drizzle-orm';
import { players, type Database } from '@hansard/db';

/** The display summary the web renders for a person on a record. */
export type PlayerSummary = { id: string; characterName: string | null; discordUsername: string };

/**
 * Look up display summaries for a set of player ids in one query, keyed by
 * id. Blank and repeated ids are ignored. Every "who wrote/did this"
 * enrichment should come through here, so a change to what a summary carries
 * happens once.
 */
export async function lookupPlayerSummaries(
  db: Database,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, PlayerSummary>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: players.id, characterName: players.characterName, discordUsername: players.discordUsername })
    .from(players)
    .where(inArray(players.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}
