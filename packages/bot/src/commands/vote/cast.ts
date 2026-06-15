import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { candidates, elections, players } from '@hansard/db';
import type { VotingMethod } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';

/**
 * /vote cast <election_id> — cast a ballot in an election.
 *
 * For yea/nay votes, shows inline buttons.
 * For secret ballots, DMs the user a ballot form.
 * For ranked/approval, would use select menus or a modal.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const electionId = interaction.options.getString('election_id', true);

  const [election] = await db
    .select({
      id: elections.id,
      title: elections.title,
      method: elections.method,
      status: elections.status,
    })
    .from(elections)
    .where(eq(elections.id, electionId))
    .limit(1);

  if (!election) {
    await interaction.reply({
      embeds: [errorEmbed('Election not found.')],
      ephemeral: true,
    });
    return;
  }

  if (election.status !== 'voting_open') {
    await interaction.reply({
      embeds: [errorEmbed('Voting is not open for this election.')],
      ephemeral: true,
    });
    return;
  }

  const method = election.method as VotingMethod;
  if (method === 'yea_nay_abstain') {
    await showYeaNayBallot(interaction, election.id, election.title);
    return;
  }

  if (method === 'fptp' || method === 'two_round_runoff' || method === 'exhaustive_ballot') {
    await showCandidateBallot(interaction, election.id, election.title);
    return;
  }

  await interaction.reply({
    embeds: [errorEmbed(`Discord voting is not available for ${formatVotingMethod(method)} elections yet. Please use the web ballot.`)],
    ephemeral: true,
  });
}

async function showYeaNayBallot(
  interaction: ChatInputCommandInteraction,
  electionId: string,
  title: string,
): Promise<void> {
    const embed = createEmbed({
      title: 'Cast Your Vote',
      description: `**${title}**\n\nSelect your vote below. Your vote will be recorded and cannot be changed.`,
      system: 'voting',
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`vote-yea:${electionId}`)
        .setLabel('Yea')
        .setStyle(ButtonStyle.Success)
        .setEmoji('\u2705'),
      new ButtonBuilder()
        .setCustomId(`vote-nay:${electionId}`)
        .setLabel('Nay')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('\u274C'),
      new ButtonBuilder()
        .setCustomId(`vote-abstain:${electionId}`)
        .setLabel('Abstain')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('\u2796'),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
}

async function showCandidateBallot(
  interaction: ChatInputCommandInteraction,
  electionId: string,
  title: string,
): Promise<void> {
  const candidateRows = await db
    .select({
      playerId: candidates.playerId,
      characterName: players.characterName,
    })
    .from(candidates)
    .leftJoin(players, eq(players.id, candidates.playerId))
    .where(and(
      eq(candidates.electionId, electionId),
      eq(candidates.isWithdrawn, false),
    ))
    .orderBy(candidates.registeredAt, candidates.id);

  if (candidateRows.length === 0) {
    await interaction.reply({
      embeds: [errorEmbed('There are no active candidates for this election.')],
      ephemeral: true,
    });
    return;
  }

  if (candidateRows.length > 25) {
    await interaction.reply({
      embeds: [errorEmbed('This election has too many candidates for Discord buttons. Please use the web ballot.')],
      ephemeral: true,
    });
    return;
  }

  const embed = createEmbed({
    title: 'Cast Your Vote',
    description: `**${title}**\n\nSelect a candidate below. Your vote will be recorded and cannot be changed.`,
    system: 'voting',
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < candidateRows.length; index += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        candidateRows.slice(index, index + 5).map((candidate) =>
          new ButtonBuilder()
            .setCustomId(`vote-candidate:${electionId}:${candidate.playerId}`)
            .setLabel(truncateLabel(candidate.characterName ?? candidate.playerId))
            .setStyle(ButtonStyle.Primary),
        ),
      ),
    );
  }

  await interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
}

function truncateLabel(label: string): string {
  return label.length <= 80 ? label : `${label.slice(0, 77)}...`;
}

function formatVotingMethod(method: VotingMethod): string {
  return method.replaceAll('_', ' ');
}
