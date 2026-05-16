import type { AutocompleteInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { favourCategories } from '@hansard/db';
import { db } from '../../db.js';

/**
 * Autocomplete handler for the `category` option on favour commands.
 *
 * Loads active favour categories from the DB, filters by what the user has
 * typed (case-insensitive substring match on either `name` or `shortName`),
 * and responds with up to 25 entries (Discord cap).
 *
 * Underscore-prefixed file so the command loader in `index.ts` can choose
 * to skip it if desired — but it's safe even if loaded, since it has no
 * default export.
 */
export async function autocompleteFavourCategory(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'category') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value ?? '').toLowerCase().trim();

  const rows = await db
    .select({
      name: favourCategories.name,
      shortName: favourCategories.shortName,
      emoji: favourCategories.emoji,
    })
    .from(favourCategories)
    .where(eq(favourCategories.isActive, true))
    .orderBy(asc(favourCategories.sortOrder), asc(favourCategories.name));

  const matched = query
    ? rows.filter((r) => {
        const name = r.name.toLowerCase();
        const short = (r.shortName ?? '').toLowerCase();
        return name.includes(query) || short.includes(query);
      })
    : rows;

  const choices = matched.slice(0, 25).map((r) => {
    const label = r.emoji ? `${r.emoji} ${r.name}` : r.name;
    // Discord caps choice name at 100 chars.
    const trimmed = label.length > 100 ? label.slice(0, 100) : label;
    return { name: trimmed, value: r.name };
  });

  await interaction.respond(choices);
}
