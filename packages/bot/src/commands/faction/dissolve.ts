import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, and, asc } from 'drizzle-orm';
import { factions, parties, players, playerEventLog } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction-dissolve')
    .setDescription('Dissolve a faction (staff only — soft delete; members and parties unassigned)')
    .addStringOption((opt) =>
      opt.setName('faction').setDescription('Faction to dissolve (name match)').setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt.setName('confirm').setDescription('Confirm the dissolution (required)').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can dissolve factions.')] });
      return;
    }

    const confirm = interaction.options.getBoolean('confirm', true);
    if (!confirm) {
      await interaction.editReply({ embeds: [errorEmbed('Pass `confirm:true` — dissolution unassigns every player and party in the faction.')] });
      return;
    }

    const query = interaction.options.getString('faction', true);
    const all = await db
      .select()
      .from(factions)
      .where(eq(factions.isActive, true))
      .orderBy(asc(factions.name));

    const target =
      all.find((f) => f.name.toLowerCase() === query.toLowerCase()) ??
      all.find((f) => f.shortName?.toLowerCase() === query.toLowerCase()) ??
      all.find((f) => f.name.toLowerCase().includes(query.toLowerCase()));

    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`No active faction matching "${query}" found.`)] });
      return;
    }

    try {
      const memberRows = await db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.factionId, target.id), eq(players.isActive, true)));

      if (memberRows.length > 0) {
        await db
          .update(players)
          .set({ factionId: null })
          .where(eq(players.factionId, target.id));

        for (const m of memberRows) {
          await db.insert(playerEventLog).values({
            playerId: m.id,
            eventType: 'faction_change',
            description: `Faction "${target.name}" was dissolved`,
            oldValue: { factionId: target.id, factionName: target.name },
            newValue: { factionId: null, factionName: null },
            isAutomatic: false,
          });
        }
      }

      const partyRows = await db
        .select({ id: parties.id })
        .from(parties)
        .where(eq(parties.factionId, target.id));

      if (partyRows.length > 0) {
        await db
          .update(parties)
          .set({ factionId: null })
          .where(eq(parties.factionId, target.id));
      }

      await db
        .update(factions)
        .set({ isActive: false })
        .where(eq(factions.id, target.id));

      await interaction.editReply({
        embeds: [successEmbed(
          'Faction Dissolved',
          `**${target.name}** has been dissolved. ${memberRows.length} member${memberRows.length === 1 ? '' : 's'} and ${partyRows.length} part${partyRows.length === 1 ? 'y' : 'ies'} unassigned.\nUse \`/faction-edit faction:${target.name} active:true\` to revive.`,
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to dissolve faction';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
