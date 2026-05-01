import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { simulationClock } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time-set')
    .setDescription('Override the current simulation date (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('date')
        .setDescription('New simulation date (YYYY-MM-DD)')
        .setRequired(true),
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
        embeds: [errorEmbed('You do not have permission to override the simulation date.')],
      });
      return;
    }

    const newDate = interaction.options.getString('date', true);

    // Validate YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      await interaction.editReply({
        embeds: [errorEmbed('Date must be in `YYYY-MM-DD` format.')],
      });
      return;
    }

    const [clock] = await db.select().from(simulationClock).limit(1);
    if (!clock) {
      await interaction.editReply({
        embeds: [errorEmbed('No simulation clock configured.')],
      });
      return;
    }

    const oldDate = clock.currentDate;

    await db
      .update(simulationClock)
      .set({ currentDate: newDate, updatedAt: new Date() })
      .where(eq(simulationClock.id, clock.id));

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Date Overridden',
          `Simulation date set to \`${newDate}\` (was \`${oldDate}\`).`,
        ),
      ],
    });
  },
};

export default command;
