import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { db } from '../../db.js';
import { previewAdvance } from '@hansard/api/services/simulationService';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time-preview')
    .setDescription('Dry-run preview of advancing the simulation (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((opt) =>
      opt
        .setName('ticks')
        .setDescription('Number of ticks to preview (default 1)')
        .setMinValue(1)
        .setMaxValue(100),
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
        embeds: [errorEmbed('You do not have permission to preview simulation advances.')],
      });
      return;
    }

    const ticks = interaction.options.getInteger('ticks') ?? 1;

    try {
      const result = await previewAdvance(db, ticks);

      const lines: string[] = [
        '_This is a preview — nothing has been committed._',
        '',
        `**${result.fromDate}** → **${result.toDate}**`,
        `Tick \`${result.fromTick}\` → \`${result.toTick}\``,
        '',
        `**${result.aged}** players would age`,
      ];

      if (result.ailmentDetails.length > 0) {
        lines.push('', '**Potential Ailments:**');
        for (const a of result.ailmentDetails.slice(0, 15)) {
          lines.push(`• **${a.characterName ?? 'Unknown'}** — ${a.condition} (${a.severity})`);
        }
        if (result.ailmentDetails.length > 15) {
          lines.push(`_…and ${result.ailmentDetails.length - 15} more_`);
        }
      }

      if (result.deathDetails.length > 0) {
        lines.push('', '⚰️ **Potential Deaths:**');
        for (const d of result.deathDetails.slice(0, 15)) {
          lines.push(`• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}`);
        }
        if (result.deathDetails.length > 15) {
          lines.push(`_…and ${result.deathDetails.length - 15} more_`);
        }
      }

      if (result.pendingDeathDetails.length > 0) {
        lines.push('', '**Potential Death Rolls:**');
        for (const d of result.pendingDeathDetails.slice(0, 15)) {
          lines.push(
            `• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}; would enter grace until tick ${d.eligibleFromTick} (${d.eligibleFromDate})`,
          );
        }
        if (result.pendingDeathDetails.length > 15) {
          lines.push(`_…and ${result.pendingDeathDetails.length - 15} more_`);
        }
      }

      if (
        result.ailmentDetails.length === 0
        && result.deathDetails.length === 0
        && result.pendingDeathDetails.length === 0
      ) {
        lines.push('', '_No ailments or deaths predicted this tick._');
      }

      const embed = createEmbed({
        title: `Preview: +${ticks} ${ticks === 1 ? 'tick' : 'ticks'}`,
        description: lines.join('\n'),
        system: 'simulation',
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
