import type { AutocompleteInteraction } from 'discord.js';
import { asc, eq } from 'drizzle-orm';
import { parties } from '@hansard/db';
import { db } from '../../db.js';

export async function autocompleteParty(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'party') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value ?? '').toLowerCase().trim();

  const rows = await db
    .select({
      id: parties.id,
      name: parties.name,
      shortName: parties.shortName,
    })
    .from(parties)
    .where(eq(parties.isActive, true))
    .orderBy(asc(parties.name));

  const matched = query
    ? rows.filter((party) => {
        const name = party.name.toLowerCase();
        const shortName = (party.shortName ?? '').toLowerCase();
        return name.includes(query) || shortName.includes(query);
      })
    : rows;

  const choices = matched.slice(0, 25).map((party) => {
    const label = party.shortName ? `${party.name} (${party.shortName})` : party.name;
    return {
      name: label.length > 100 ? label.slice(0, 100) : label,
      value: party.id,
    };
  });

  await interaction.respond(choices);
}
