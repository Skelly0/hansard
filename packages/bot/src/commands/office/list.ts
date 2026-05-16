import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, asc, isNull } from 'drizzle-orm';
import { offices, officeHolders, players } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const allOffices = await db
    .select()
    .from(offices)
    .where(eq(offices.isActive, true))
    .orderBy(asc(offices.sortOrder), asc(offices.name));

  if (allOffices.length === 0) {
    const embed = createEmbed({
      title: 'Offices',
      description: 'No offices have been created yet.',
      system: 'offices',
    });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const currentHolders = await db
    .select({
      officeId: officeHolders.officeId,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(officeHolders)
    .innerJoin(players, eq(officeHolders.playerId, players.id))
    .where(isNull(officeHolders.endDate));

  const holdersByOffice = new Map<string, string[]>();
  for (const h of currentHolders) {
    const list = holdersByOffice.get(h.officeId) ?? [];
    list.push(h.playerName ?? h.discordUsername);
    holdersByOffice.set(h.officeId, list);
  }

  const fields = allOffices.map((office) => {
    const holders = holdersByOffice.get(office.id);
    const holderText = holders && holders.length > 0
      ? holders.join(', ')
      : '*Vacant*';

    return {
      name: office.name,
      value: [
        `**Tier:** ${formatTier(office.tier)}`,
        `**Holder:** ${holderText}`,
        `**Filled by:** ${office.filledBy}`,
      ].join('\n'),
      inline: true,
    };
  });

  const embed = createEmbed({
    title: 'Offices',
    description: `${allOffices.length} office${allOffices.length === 1 ? '' : 's'} registered.`,
    system: 'offices',
    fields,
  });

  await interaction.editReply({ embeds: [embed] });
}

function formatTier(tier: string): string {
  return tier
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
