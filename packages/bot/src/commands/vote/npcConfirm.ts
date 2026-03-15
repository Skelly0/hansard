import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /npc-confirm <election_id> <yea> <nay> <abstain> [notes]
 *
 * Staff-only command to enter the NPC house confirmation result
 * for a position election or appointment confirmation.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('npc-confirm')
    .setDescription('Enter NPC house confirmation for an election (staff only)')
    .addStringOption((opt) =>
      opt
        .setName('election_id')
        .setDescription('The election ID')
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('yea')
        .setDescription('Number of NPC yea votes')
        .setRequired(true)
        .setMinValue(0),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('nay')
        .setDescription('Number of NPC nay votes')
        .setRequired(true)
        .setMinValue(0),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('abstain')
        .setDescription('Number of NPC abstain votes')
        .setRequired(true)
        .setMinValue(0),
    )
    .addStringOption((opt) =>
      opt
        .setName('notes')
        .setDescription('Optional notes about the NPC decision')
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Staff check
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    const staffCheck = await isStaff(member as any);
    if (!staffCheck) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff can enter NPC house results.')],
        ephemeral: true,
      });
      return;
    }

    const electionId = interaction.options.getString('election_id', true);
    const yea = interaction.options.getInteger('yea', true);
    const nay = interaction.options.getInteger('nay', true);
    const abstain = interaction.options.getInteger('abstain', true);
    const notes = interaction.options.getString('notes') ?? undefined;

    const total = yea + nay + abstain;
    const confirmed = yea > nay;

    // TODO: Call the API — POST /api/elections/:id/npc-confirm

    const resultColour = confirmed ? 0x788C5D : 0xC25B4E;
    const resultText = confirmed ? 'CONFIRMED' : 'REJECTED';

    const embed = createEmbed({
      title: `NPC House: ${resultText}`,
      description: notes ? `> ${notes}` : undefined,
      system: 'voting',
      colour: resultColour,
      fields: [
        { name: 'Election', value: `\`${electionId}\``, inline: true },
        {
          name: 'NPC Tally',
          value: `\`Yea: ${yea} | Nay: ${nay} | Abs: ${abstain}\``,
          inline: true,
        },
        { name: 'Total', value: `\`${total}\``, inline: true },
        { name: 'Result', value: `**${resultText}**`, inline: true },
      ],
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
