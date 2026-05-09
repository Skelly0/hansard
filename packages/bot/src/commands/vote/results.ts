import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { candidates, elections, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /vote results <election_id> — show election results.
 *
 * Displays the tally, winner(s), and round-by-round breakdown
 * for multi-round elections. Respects sealed results.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-results')
    .setDescription('Show the results of an election')
    .addStringOption((opt) =>
      opt
        .setName('election_id')
        .setDescription('The election ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const electionId = interaction.options.getString('election_id', true);

    const [election] = await db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(`Election \`${electionId}\` not found.`)],
      });
      return;
    }

    const config = election.config as { sealedResults?: boolean };
    if (config.sealedResults && election.status === 'voting_open') {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: election.title,
            description: 'Results are sealed until voting closes.',
            system: 'voting',
            fields: [{ name: 'Status', value: `\`${election.status}\``, inline: true }],
          }),
        ],
      });
      return;
    }

    const candidateNames = await getCandidateNames(electionId);
    const embed = buildResultsEmbed({
      title: election.title,
      method: election.method,
      results: election.results,
      candidateNames,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

/**
 * Build a results embed from election data.
 * Used by both the command and by the vote service after tallying.
 */
export function buildResultsEmbed(election: {
  title: string;
  method: string;
  results: {
    totalVotes: number;
    turnout: number;
    passed?: boolean;
    finalTallies: Record<string, number>;
    winners?: string[];
    rounds?: { round: number; tallies: Record<string, number>; eliminated?: string }[];
    seatAllocation?: Record<string, number>;
    runoffTriggered?: boolean;
  } | null;
  candidateNames?: Record<string, string>; // id -> display name
}) {
  const r = election.results;
  if (!r) {
    return errorEmbed('No results available for this election.');
  }

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Total Votes', value: `\`${r.totalVotes}\``, inline: true },
  ];

  // Yea/Nay display
  if (r.finalTallies.yea !== undefined) {
    const yea = r.finalTallies.yea ?? 0;
    const nay = r.finalTallies.nay ?? 0;
    const abstain = r.finalTallies.abstain ?? 0;

    fields.push({
      name: 'Tally',
      value: `\`Yea: ${yea} | Nay: ${nay} | Abs: ${abstain}\``,
      inline: true,
    });

    if (r.passed !== undefined) {
      fields.push({
        name: 'Result',
        value: r.passed ? '**PASSED**' : '**REJECTED**',
        inline: true,
      });
    }
  } else {
    // Candidate-based tally
    const names = election.candidateNames ?? {};
    const sorted = Object.entries(r.finalTallies).sort((a, b) => b[1] - a[1]);
    const tallyLines = sorted
      .slice(0, 10)
      .map(([id, votes]) => `${names[id] ?? id}: \`${votes}\``)
      .join('\n');

    fields.push({ name: 'Tallies', value: tallyLines || 'No votes cast' });
  }

  // Winners
  if (r.winners && r.winners.length > 0) {
    const names = election.candidateNames ?? {};
    const winnerDisplay = r.winners.map((id) => names[id] ?? id).join(', ');
    fields.push({ name: 'Winner(s)', value: `**${winnerDisplay}**` });
  }

  // Seat allocation (proportional)
  if (r.seatAllocation) {
    const names = election.candidateNames ?? {};
    const seatLines = Object.entries(r.seatAllocation)
      .filter(([, seats]) => seats > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, seats]) => `${names[id] ?? id}: \`${seats} seat(s)\``)
      .join('\n');
    fields.push({ name: 'Seat Allocation', value: seatLines });
  }

  // Runoff
  if (r.runoffTriggered) {
    fields.push({
      name: 'Runoff',
      value: 'No candidate met the threshold. A runoff is required.',
    });
  }

  // Multi-round summary
  if (r.rounds && r.rounds.length > 1) {
    const names = election.candidateNames ?? {};
    const roundSummary = r.rounds
      .map((round) => {
        const line = `**Round ${round.round}**: ${Object.entries(round.tallies)
          .sort((a, b) => b[1] - a[1])
          .map(([id, v]) => `${names[id] ?? id} (${v})`)
          .join(', ')}`;
        return round.eliminated
          ? `${line} — *${names[round.eliminated] ?? round.eliminated} eliminated*`
          : line;
      })
      .join('\n');
    fields.push({ name: 'Rounds', value: roundSummary });
  }

  // Determine colour — green if passed/has winner, red if rejected, blue otherwise
  const passedOrWon = r.passed === true || (r.winners && r.winners.length > 0 && !r.runoffTriggered);
  const colour = r.passed === false ? 0xC25B4E : passedOrWon ? 0x788C5D : 0x6A9BCC;

  return createEmbed({
    title: election.title,
    system: 'voting',
    colour,
    fields,
  });
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

export default command;
