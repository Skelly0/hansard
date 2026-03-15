import {
  type ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';

/**
 * Handle vote button interactions.
 *
 * Button customId format:
 *   vote-yea:<electionId>
 *   vote-nay:<electionId>
 *   vote-abstain:<electionId>
 *   vote-candidate:<electionId>:<candidateId>
 *   vote-confirm:<electionId>:<choice>
 */
export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const [action, electionId, extra] = interaction.customId.split(':');

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
  // TODO: Call the API to cast the ballot
  // POST /api/elections/:id/vote
  // Body depends on the election method

  let voteDescription: string;

  if (['yea', 'nay', 'abstain'].includes(choiceData)) {
    voteDescription = choiceData.toUpperCase();
  } else if (choiceData.startsWith('candidate:')) {
    const candidateId = choiceData.replace('candidate:', '');
    voteDescription = `Candidate \`${candidateId}\``;
  } else {
    voteDescription = choiceData;
  }

  const embed = successEmbed(
    'Vote Recorded',
    `Your vote of **${voteDescription}** has been recorded for election \`${electionId}\`.`,
  );

  await interaction.update({
    embeds: [embed],
    components: [], // remove buttons after voting
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
