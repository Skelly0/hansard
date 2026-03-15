import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /elect <office> [method] — Create a position election.
 *
 * Chancellor-only command. Creates an election with type 'position_election'
 * linked to the specified office. Candidates can then submit themselves.
 *
 * Example: /elect "Governor of Northshire" fptp
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('elect')
    .setDescription('Create a position election (Chancellor only)')
    .addStringOption((opt) =>
      opt
        .setName('office')
        .setDescription('The office to elect for (e.g. "Governor of Northshire")')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('method')
        .setDescription('Voting method (default: fptp)')
        .setRequired(false)
        .addChoices(
          { name: 'First Past the Post', value: 'fptp' },
          { name: 'Ranked Choice (IRV)', value: 'ranked_choice' },
          { name: 'Two-Round Runoff', value: 'two_round_runoff' },
          { name: 'Exhaustive Ballot', value: 'exhaustive_ballot' },
          { name: 'Approval Voting', value: 'approval' },
          { name: 'STV (Multi-Seat)', value: 'stv' },
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Permission check — requires legislative_leader or staff
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    const permitted = await hasPermission(member as any, 'voting.create');
    if (!permitted) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can create position elections.')],
        ephemeral: true,
      });
      return;
    }

    const officeName = interaction.options.getString('office', true);
    const method = interaction.options.getString('method') ?? 'fptp';

    // TODO: Look up the office by name from the API and get forOfficeId.
    // TODO: Create the election via the API with type 'position_election'.

    const embed = createEmbed({
      title: `Position Election: ${officeName}`,
      description: [
        `A position election has been created for **${officeName}**.`,
        '',
        `**Method:** ${method}`,
        `**Status:** Nominations Open`,
        '',
        'Candidates can submit themselves using `/candidate submit`.',
      ].join('\n'),
      system: 'voting',
      fields: [
        { name: 'Office', value: officeName, inline: true },
        { name: 'Method', value: method, inline: true },
        { name: 'Status', value: 'Nominations Open', inline: true },
      ],
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
