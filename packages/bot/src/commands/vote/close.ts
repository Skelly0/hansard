import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { elections } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /vote-close election:<title> — closes voting for an election.
 *
 * Mirrors VoteService.closeVoting: transitions status to `voting_closed`.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-close')
    .setDescription('Close voting on an election (Chancellor/staff)')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member as GuildMember | null;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    const permitted = await hasPermission(member, 'voting.close');
    if (!permitted) {
      await interaction.editReply({
        embeds: [errorEmbed('Only the Chancellor or staff can close elections.')],
      });
      return;
    }

    const electionTitle = interaction.options.getString('election', true);

    const [election] = await db
      .select()
      .from(elections)
      .where(ilike(elections.title, electionTitle))
      .limit(1);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(`No election found with title \`${electionTitle}\`.`)],
      });
      return;
    }

    if (election.status !== 'voting_open') {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Cannot close an election in \`${election.status}\` status. Only \`voting_open\` elections can be closed.`,
          ),
        ],
      });
      return;
    }

    // Mirror VoteService.closeVoting
    const [updated] = await db
      .update(elections)
      .set({ status: 'voting_closed', updatedAt: new Date() })
      .where(eq(elections.id, election.id))
      .returning();

    if (!updated) {
      await interaction.editReply({
        embeds: [errorEmbed('Failed to close election.')],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Voting Closed',
          `**${updated.title}** is now closed. Use \`/vote-tally\` to compute results.`,
        ),
      ],
    });

    // Public announcement
    const announce = createEmbed({
      title: 'Voting is Closed',
      description: `**${updated.title}** has closed. Results will be tallied shortly.`,
      system: 'voting',
    });

    if (interaction.channel && 'send' in interaction.channel) {
      try {
        await (interaction.channel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [announce] });
      } catch {
        // Non-critical announcement
      }
    }
  },
};

export default command;
