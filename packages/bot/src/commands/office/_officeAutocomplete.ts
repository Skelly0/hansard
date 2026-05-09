import type { AutocompleteInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { offices } from '@hansard/db';
import { db } from '../../db.js';

/**
 * Autocomplete handler for the `office` option on office commands
 * (`/appoint`, `/dismiss`, `/office-info`).
 *
 * Loads active offices from the DB, filters by what the user has typed
 * (case-insensitive substring match on `name`), and responds with up to
 * 25 entries (Discord cap).
 *
 * Returns the canonical office `name` as the option value because the
 * existing `execute` handlers resolve the option as a name string
 * (case-insensitive match against `offices.name`).
 *
 * Underscore-prefixed file so the command loader in `index.ts` skips
 * it (no default export → loader logs a warning and moves on, which is
 * the existing graceful-skip behaviour).
 */
export async function autocompleteOffice(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'office') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value ?? '').toLowerCase().trim();

  const rows = await db
    .select({
      name: offices.name,
      tier: offices.tier,
    })
    .from(offices)
    .where(eq(offices.isActive, true))
    .orderBy(asc(offices.sortOrder), asc(offices.name));

  const matched = query
    ? rows.filter((r) => r.name.toLowerCase().includes(query))
    : rows;

  const choices = matched.slice(0, 25).map((r) => {
    // Discord caps choice name at 100 chars.
    const trimmed = r.name.length > 100 ? r.name.slice(0, 100) : r.name;
    return { name: trimmed, value: r.name };
  });

  await interaction.respond(choices);
}
