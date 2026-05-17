import {
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { VoteService } from '@hansard/api/services/voteService';
import { candidates, players } from '@hansard/db';
import { errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import { buildResultsEmbed } from './results.js';
import { findElectionByReference } from './_electionReference.js';
import { autoEnactPassedBillFromElection } from '../bills/autoEnact.js';

/**
 * /vote tally election:<title-or-id> — staff force-tally an election.
 *
 * Mirrors VoteService.tallyVotes.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
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

    const electionRef = interaction.options.getString('election', true);

    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    // Mirror VoteService.tallyVotes guard — tallying a still-open vote would
    // short-circuit the voting window and expose results through the sealed
    // gate, so callers must close the vote first.
    if (election.status !== 'voting_closed') {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Election must be in \`voting_closed\` status to tally (currently \`${election.status}\`). Run \`/vote close\` first.`,
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

    let autoEnactFailed = false;
    try {
      await autoEnactPassedBillFromElection({
        database: db,
        client: interaction.client,
        election,
      });
    } catch (err) {
      autoEnactFailed = true;
      console.error('[vote-tally] failed to auto-enact linked legislative bill:', err);
    }

    const embed = buildResultsEmbed({
      title: election.title,
      method: election.method,
      results,
      candidateNames: await getCandidateNames(election.id),
    });
    if (autoEnactFailed) {
      embed.addFields({
        name: 'Auto-enactment',
        value: 'The vote was tallied, but the linked bill could not be automatically enacted. Run `/bill enact` after checking logs.',
      });
    }

    await interaction.editReply({ embeds: [embed] });
}

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
