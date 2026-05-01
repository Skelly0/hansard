import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { desc, inArray } from 'drizzle-orm';
import { db } from '../../db.js';
import { timeAdvanceLog, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /time-history limit:<int>?
 *
 * Mirrors GET /api/simulation/history.
 * Lists the most recent simulation advance log entries.
 */

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time-history')
    .setDescription('Recent simulation advance log entries')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('Number of entries to show (default 10)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({
        embeds: [errorEmbed('This command must be used in a server.')],
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaff(member))) {
      await interaction.editReply({
        embeds: [errorEmbed('You do not have permission to view simulation history.')],
      });
      return;
    }

    const limit = interaction.options.getInteger('limit') ?? 10;

    const rows = await db
      .select()
      .from(timeAdvanceLog)
      .orderBy(desc(timeAdvanceLog.createdAt))
      .limit(limit);

    if (rows.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Time Advance History',
            description: '_No advance log entries yet._',
            system: 'simulation',
          }),
        ],
      });
      return;
    }

    // Resolve advancer player ids → display names
    const advancerIds = Array.from(new Set(rows.map((r) => r.advancedById).filter(Boolean)));
    const nameMap = new Map<string, string>();

    if (advancerIds.length > 0) {
      const playerRows = await db
        .select({
          id: players.id,
          characterName: players.characterName,
          discordUsername: players.discordUsername,
        })
        .from(players)
        .where(inArray(players.id, advancerIds));

      for (const p of playerRows) {
        nameMap.set(p.id, p.characterName ?? p.discordUsername ?? 'Unknown');
      }
    }

    const lines = rows.map((row) => {
      const advancer = nameMap.get(row.advancedById) ?? '_unknown_';
      const ticks = row.toTick - row.fromTick;
      const summary = row.summary ?? { deaths: [], ailments: [], aged: 0 };
      const deaths = summary.deaths?.length ?? 0;
      const ailments = summary.ailments?.length ?? 0;
      const aged = summary.aged ?? 0;
      const when = `<t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`;

      const parts = [
        `**${row.fromDate}** → **${row.toDate}** (${ticks > 0 ? '+' : ''}${ticks} tick${ticks === 1 ? '' : 's'})`,
        `  by **${advancer}** • ${when}`,
        `  aged: ${aged} • ailments: ${ailments} • deaths: ${deaths}`,
      ];

      return parts.join('\n');
    });

    const embed = createEmbed({
      title: 'Time Advance History',
      description: [`Showing last **${rows.length}** entr${rows.length === 1 ? 'y' : 'ies'}.`, '', lines.join('\n\n')].join('\n'),
      system: 'simulation',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
