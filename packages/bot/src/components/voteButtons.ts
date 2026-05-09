import {
  type ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections, players } from '@hansard/db';
import { VoteService } from '@hansard/api/services/voteService';
import type { BallotVote, VotingMethod } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { db } from '../db.js';

const voteService = new VoteService(db);

/**
 * Handle vote button interactions.
 *
 * Button customId format:
 *   vote-yea:<electionId>
 *   vote-nay:<electionId>
 *   vote-abstain:<electionId>
 *   vote-candidate:<electionId>:<candidateId>
 *   vote-confirm:<electionId>:<choice>
 *   vote-confirm:<electionId>:candidate:<candidateId>
 */
export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const [action, electionId, ...extraParts] = interaction.customId.split(':');
  const extra = extraParts.join(':');

  switch (action) {
    case 'vote-yea':
    case 'vote-nay':
    case 'vote-abstain':
      await handleYeaNayVote(interaction, action, electionId);
      break;

    case 'vote-candidate':
      await handleCandidateVote(interaction, electionId, extra);
      break;

    case 'vote-confirm':
      await handleConfirmVote(interaction, electionId, extra);
      break;

    default:
      await interaction.reply({
        embeds: [errorEmbed('Unknown vote action.')],
        ephemeral: true,
      });
  }
}

// ------------------------------------------------------------------
// Yea / Nay / Abstain
// ------------------------------------------------------------------

async function handleYeaNayVote(
  interaction: ButtonInteraction,
  action: string,
  electionId: string,
): Promise<void> {
  const choice = action.replace('vote-', '') as 'yea' | 'nay' | 'abstain';

  // Show confirmation button — prevent accidental clicks
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote-confirm:${electionId}:${choice}`)
      .setLabel(`Confirm: ${choice.toUpperCase()}`)
      .setStyle(
        choice === 'yea'
          ? ButtonStyle.Success
          : choice === 'nay'
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary,
      ),
    new ButtonBuilder()
      .setCustomId('vote-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = createEmbed({
    title: 'Confirm Your Vote',
    description: `You are voting **${choice.toUpperCase()}** on election \`${electionId}\`.\n\nThis action cannot be undone. Click confirm to submit.`,
    system: 'voting',
  });

  await interaction.reply({
    embeds: [embed],
    components: [confirmRow],
    ephemeral: true,
  });
}

// ------------------------------------------------------------------
// Candidate selection (FPTP / two-round)
// ------------------------------------------------------------------

async function handleCandidateVote(
  interaction: ButtonInteraction,
  electionId: string,
  candidateId: string,
): Promise<void> {
  // Show confirmation
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote-confirm:${electionId}:candidate:${candidateId}`)
      .setLabel('Confirm Vote')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('vote-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = createEmbed({
    title: 'Confirm Your Vote',
    description: `Voting for candidate \`${candidateId}\` in election \`${electionId}\`.`,
    system: 'voting',
  });

  await interaction.reply({
    embeds: [embed],
    components: [confirmRow],
    ephemeral: true,
  });
}

// ------------------------------------------------------------------
// Confirmation — actually submit the ballot
// ------------------------------------------------------------------

async function handleConfirmVote(
  interaction: ButtonInteraction,
  electionId: string,
  choiceData: string,
): Promise<void> {
  await interaction.deferUpdate();

  let voteDescription: string;
  let votePayload: BallotVote;

  try {
    const [voter] = await db
      .select({
        id: players.id,
      })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!voter) {
      await interaction.followUp({
        embeds: [errorEmbed('You are not registered as a player. Run `/character create` first.')],
        ephemeral: true,
      });
      return;
    }

    const [election] = await db
      .select({
        method: elections.method,
      })
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      await interaction.followUp({
        embeds: [errorEmbed('Election not found.')],
        ephemeral: true,
      });
      return;
    }

    const ballot = buildBallot(choiceData, election.method as VotingMethod);
    if (!ballot) {
      await interaction.followUp({
        embeds: [errorEmbed(`This ballot control is not valid for a ${formatVotingMethod(election.method as VotingMethod)} election.`)],
        ephemeral: true,
      });
      return;
    }

    ({ voteDescription, votePayload } = ballot);

    await voteService.castBallot({
      electionId,
      voterId: voter.id,
      vote: votePayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record vote';
    const friendly = /unique|duplicate/i.test(message)
      ? 'You have already voted in this election.'
      : message;
    await interaction.followUp({
      embeds: [errorEmbed(friendly)],
      ephemeral: true,
    });
    return;
  }

  const embed = successEmbed(
    'Vote Recorded',
    `Your vote of **${voteDescription}** has been recorded for election \`${electionId}\`.`,
  );

  await interaction.editReply({
    embeds: [embed],
    components: [],
  });
}

/**
 * Check if a customId belongs to the vote button system.
 */
export function isVoteButton(customId: string): boolean {
  return (
    customId.startsWith('vote-yea:') ||
    customId.startsWith('vote-nay:') ||
    customId.startsWith('vote-abstain:') ||
    customId.startsWith('vote-candidate:') ||
    customId.startsWith('vote-confirm:') ||
    customId === 'vote-cancel'
  );
}

/**
 * Handle the vote-cancel button.
 */
export async function handleVoteCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [createEmbed({ title: 'Vote Cancelled', system: 'voting' })],
    components: [],
  });
}

function buildBallot(
  choiceData: string,
  method: VotingMethod,
): { voteDescription: string; votePayload: BallotVote } | null {
  if (choiceData === 'yea' || choiceData === 'nay' || choiceData === 'abstain') {
    if (method !== 'yea_nay_abstain') return null;
    return {
      voteDescription: choiceData.toUpperCase(),
      votePayload: { type: 'yea_nay_abstain', choice: choiceData },
    };
  }

  if (!choiceData.startsWith('candidate:')) {
    return null;
  }

  const candidateId = choiceData.replace('candidate:', '');
  const voteDescription = `Candidate \`${candidateId}\``;

  switch (method) {
    case 'fptp':
      return { voteDescription, votePayload: { type: 'fptp', candidateId } };
    case 'two_round_runoff':
      return { voteDescription, votePayload: { type: 'two_round', candidateId } };
    case 'exhaustive_ballot':
      return { voteDescription, votePayload: { type: 'exhaustive', candidateId } };
    default:
      return null;
  }
}

function formatVotingMethod(method: VotingMethod): string {
  return method.replaceAll('_', ' ');
}
