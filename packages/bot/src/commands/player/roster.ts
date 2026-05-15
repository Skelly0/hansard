import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, and, isNull, isNotNull, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, factions, parties, offices, officeHolders } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';

// Office tier ranking — lower number = higher tier (used to pick top-tier office).
const TIER_RANK: Record<string, number> = {
  head_of_state: 0,
  head_of_government: 1,
  cabinet: 2,
  legislature: 3,
  regional: 4,
};

function tierRank(tier: string): number {
  return TIER_RANK[tier] ?? 99;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const factionFilter = interaction.options.getString('faction')?.trim().toLowerCase();
    const partyFilter = interaction.options.getString('party')?.trim().toLowerCase();

    // Resolve filters to IDs
    let factionId: string | null = null;
    let factionLabel: string | null = null;
    if (factionFilter) {
      const all = await db.select().from(factions).where(eq(factions.isActive, true));
      const match = all.find(
        (f) =>
          f.name.toLowerCase() === factionFilter ||
          f.shortName?.toLowerCase() === factionFilter ||
          f.name.toLowerCase().includes(factionFilter),
      );
      if (!match) {
        await interaction.editReply({
          embeds: [errorEmbed(`No faction matching "${factionFilter}" found.`)],
        });
        return;
      }
      factionId = match.id;
      factionLabel = match.name;
    }

    let partyId: string | null = null;
    let partyLabel: string | null = null;
    if (partyFilter) {
      const all = await db.select().from(parties).where(eq(parties.isActive, true));
      const match = all.find(
        (p) =>
          p.name.toLowerCase() === partyFilter ||
          p.shortName?.toLowerCase() === partyFilter ||
          p.name.toLowerCase().includes(partyFilter),
      );
      if (!match) {
        await interaction.editReply({
          embeds: [errorEmbed(`No party matching "${partyFilter}" found.`)],
        });
        return;
      }
      partyId = match.id;
      partyLabel = match.name;
    }

    // Build active-player query with optional filters
    const conditions = [eq(players.isActive, true), isNotNull(players.characterName)];
    if (factionId) conditions.push(eq(players.factionId, factionId));
    if (partyId) conditions.push(eq(players.partyId, partyId));

    const roster = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordId: players.discordId,
        partyId: players.partyId,
      })
      .from(players)
      .where(and(...conditions))
      .orderBy(asc(players.characterName));

    if (roster.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Roster',
            description: '*No players match those filters.*',
            system: 'players',
          }),
        ],
      });
      return;
    }

    // Collect party names in one query
    const partyIds = [...new Set(roster.map((r) => r.partyId).filter((x): x is string => Boolean(x)))];
    const partyMap = new Map<string, string>();
    if (partyIds.length > 0) {
      const partyRows = await db.select({ id: parties.id, name: parties.name }).from(parties);
      for (const p of partyRows) partyMap.set(p.id, p.name);
    }

    // Top-tier office per player — pull all active office holders for these players
    const topOfficeMap = new Map<string, { name: string; tier: string }>();
    if (roster.length > 0) {
      const allOffices = await db
        .select({
          playerId: officeHolders.playerId,
          officeName: offices.name,
          officeTier: offices.tier,
        })
        .from(officeHolders)
        .innerJoin(offices, eq(officeHolders.officeId, offices.id))
        .where(isNull(officeHolders.endDate));

      for (const row of allOffices) {
        const existing = topOfficeMap.get(row.playerId);
        if (!existing || tierRank(row.officeTier) < tierRank(existing.tier)) {
          topOfficeMap.set(row.playerId, { name: row.officeName, tier: row.officeTier });
        }
      }
    }

    const lines = roster.map((p) => {
      const partyName = p.partyId ? partyMap.get(p.partyId) ?? 'Unknown' : 'Independent';
      const office = topOfficeMap.get(p.id);
      const officeText = office ? ` — *${office.name}*` : '';
      return `**${p.characterName ?? '(unnamed)'}** <@${p.discordId}> (${partyName})${officeText}`;
    });

    // Discord embed description cap is 4096; chunk if needed
    const description = lines.join('\n').slice(0, 4000);

    const filterBits: string[] = [];
    if (factionLabel) filterBits.push(`Faction: **${factionLabel}**`);
    if (partyLabel) filterBits.push(`Party: **${partyLabel}**`);

    const embed = createEmbed({
      title: `Roster (${roster.length})`,
      description,
      system: 'players',
      fields: filterBits.length > 0
        ? [{ name: 'Filters', value: filterBits.join(' • ') }]
        : undefined,
    });

  await interaction.editReply({ embeds: [embed] });
}
