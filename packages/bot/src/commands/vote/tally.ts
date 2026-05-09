import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { VoteService } from '@hansard/api/services/voteService';
import { candidates, elections, players } from '@hansard/db';
import { errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import { buildResultsEmbed } from './results.js';
import type { Command } from '../../client.js';

/**
 * /vote-tally election:<title> — staff force-tally an election.
 *
 * Mirrors VoteService.tallyVotes.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-tally')
    .setDescription('Force-tally an election (staff)')
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
        embeds: [errorEmbed('Only staff can force-tally an election.')],
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

    // Mirror VoteService.tallyVotes guard
    if (!['voting_closed', 'voting_open'].includes(election.status)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Election must be in \`voting_closed\` or \`voting_open\` status to tally (currently \`${election.status}\`).`,
          ),
        ],
      });
      return;
    }

    let results;
    try {
      results = await new VoteService(db).tallyVotes(election.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to tally election';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }

    const embed = buildResultsEmbed({
      title: election.title,
      method: election.method,
      results,
      candidateNames: await getCandidateNames(election.id),
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

async function getCandidateNames(electionId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({
      playerId: candidates.playerId,
      characterName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(candidates)
    .innerJoin(players, eq(candidates.playerId, players.id))
    .where(eq(candidates.electionId, electionId));

  return Object.fromEntries(
    rows.map((row) => [
      row.playerId,
      row.characterName ?? row.discordUsername,
    ]),
  );
}

export default command;
