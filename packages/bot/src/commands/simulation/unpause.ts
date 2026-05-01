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
    .setName('time-unpause')
    .setDescription('Resume the simulation clock (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

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
        embeds: [errorEmbed('You do not have permission to resume the simulation.')],
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

    if (!clock.isPaused) {
      await interaction.editReply({
        embeds: [errorEmbed('Clock is already running.')],
      });
      return;
    }

    await db
      .update(simulationClock)
      .set({ isPaused: false, updatedAt: new Date() })
      .where(eq(simulationClock.id, clock.id));

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Clock Resumed',
          'The simulation clock is now running. Time can be advanced.',
        ),
      ],
    });
  },
};

export default command;
