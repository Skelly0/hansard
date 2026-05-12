import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
} from 'discord.js';
import { eq, inArray } from 'drizzle-orm';
import { ballots, candidates, elections, players } from '@hansard/db';
import { meetsVoteThreshold, SUPERMAJORITY_PASS_THRESHOLD } from '@hansard/shared';
import { client } from '../../client.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';
import { findElectionByReference } from './_electionReference.js';

const METHOD_LABELS: Record<string, string> = {
  yea_nay_abstain: 'Yea / Nay / Abstain',
  fptp: 'First Past the Post',
  ranked_choice: 'Ranked Choice (IRV)',
  approval: 'Approval Voting',
  two_round_runoff: 'Two-Round Runoff',
  exhaustive_ballot: 'Exhaustive Ballot',
  stv: 'Single Transferable Vote',
  proportional: 'Proportional Representation',
};

const TYPE_LABELS: Record<string, string> = {
  referendum: 'Referendum',
  confidence_vote: 'Vote of Confidence',
  party_primary: 'Party Primary',
  custom: 'Custom Vote',
  legislative_vote: 'Legislative Vote',
  position_election: 'Position Election',
  appointment_confirmation: 'Appointment Confirmation',
  general_election: 'General Election',
  constitutional_amendment: 'Constitutional Amendment',
};

const MAJORITY_LABELS: Record<string, string> = {
  simple: 'Simple Majority',
  absolute: 'Absolute Majority',
  supermajority: 'Supermajority',
  qualified: 'Qualified Majority',
  unanimous: 'Unanimous',
};

function formatMajority(majorityType: string | undefined, passThreshold: number | undefined): string {
  const key = majorityType ?? 'simple';
  const label = MAJORITY_LABELS[key] ?? key;
  if ((key === 'supermajority' || key === 'qualified') && typeof passThreshold === 'number') {
    return `${label} (${Math.round(passThreshold * 100)}%)`;
  }
  return label;
}

/**
 * /vote-close election:<title-or-id> — closes voting for an election.
 *
 * Mirrors VoteService.closeVoting: transitions status to `voting_closed`.
 *
 * For reaction-mode votes (election.useReactions = true), this command
 * additionally:
 *   - Computes a quick inline tally (yea/nay/abstain or FPTP candidate counts)
 *     directly from `ballots`. The full tally pipeline still lives in the API
 *     package; this is a UX shortcut so the embed reflects the result without
 *     a separate `/vote-tally` round-trip.
 *   - Fetches the original posted message via discordMessageId/discordChannelId
 *     and replaces its embed with a results view.
 *   - Leaves reactions in place so the public vote record remains inspectable.
 *
 * Button-mode votes are unchanged: they get a public "Voting is Closed" notice
 * and rely on `/vote-tally` + `/vote-results` for the result view.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-close')
    .setDescription('Close voting on an election (Chancellor/staff)')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title or ID')
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

    const electionRef = interaction.options.getString('election', true);

    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
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

    // ---- Reaction-mode: rewrite the original embed in-place ----
    if (updated.useReactions && updated.discordMessageId && updated.discordChannelId) {
      try {
        await renderReactionResult(updated);
      } catch (error) {
        console.error('[vote-close] failed to render reaction result:', error);
        // Non-fatal — the election is still marked closed; staff can re-run results manually.
      }
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Voting Closed',
          updated.useReactions
            ? `**${updated.title}** is now closed. The vote embed has been updated with results.`
            : `**${updated.title}** is now closed. Use \`/vote-tally\` to compute results.`,
        ),
      ],
    });

    // Public announcement (only for button-mode — reaction-mode already
    // shows the result inline on the embed, so a separate notice is noisy).
    if (!updated.useReactions) {
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
    }
  },
};

/**
 * Compute a quick yea_nay_abstain or fptp tally and update the original
 * vote embed in-place. Reactions stay visible after close as the public
 * vote record.
 *
 * This intentionally does NOT use the API tally strategies — those live
 * in the API package and the bot doesn't import them. For yea/nay/abstain
 * and FPTP the math is trivial enough to do inline; richer methods that
 * could ever support reaction mode would need a different path.
 */
export async function renderReactionResult(election: typeof elections.$inferSelect): Promise<void> {
  if (!election.discordMessageId || !election.discordChannelId) return;

  // Fetch ballots
  const allBallots = await db
    .select()
    .from(ballots)
    .where(eq(ballots.electionId, election.id));

  // Compute tally + result text per method
  let resultLines: string[];
  let resultHeadline: string;
  let passed: boolean | undefined;

  if (election.method === 'yea_nay_abstain') {
    let yea = 0;
    let nay = 0;
    let abstain = 0;
    for (const b of allBallots) {
      if (b.vote.type !== 'yea_nay_abstain') continue;
      if (b.vote.choice === 'yea') yea += 1;
      else if (b.vote.choice === 'nay') nay += 1;
      else if (b.vote.choice === 'abstain') abstain += 1;
    }

    const config = election.config ?? {};
    const votingVotes = yea + nay;
    const totalVotes = votingVotes + abstain;
    switch (config.majorityType ?? 'simple') {
      case 'absolute':
        passed = config.quorumRequired != null
          ? yea > config.quorumRequired / 2
          : yea > totalVotes / 2;
        break;
      case 'supermajority':
      case 'qualified':
        passed = meetsVoteThreshold(
          yea,
          votingVotes,
          config.passThreshold ?? SUPERMAJORITY_PASS_THRESHOLD,
        );
        break;
      case 'unanimous':
        passed = yea > 0 && nay === 0;
        break;
      case 'simple':
      default:
        passed = yea > nay;
    }

    resultHeadline = passed ? '**PASSED**' : '**REJECTED**';
    resultLines = [
      `Yea: **${yea}**`,
      `Nay: **${nay}**`,
      `Abstain: **${abstain}**`,
    ];
  } else if (election.method === 'fptp') {
    // Resolve candidate names + counts
    const cRows = await db
      .select()
      .from(candidates)
      .where(eq(candidates.electionId, election.id))
      .orderBy(candidates.registeredAt);

    const tally = new Map<string, number>();
    for (const c of cRows) tally.set(c.playerId, 0);
    for (const b of allBallots) {
      if (b.vote.type !== 'fptp') continue;
      tally.set(b.vote.candidateId, (tally.get(b.vote.candidateId) ?? 0) + 1);
    }

    const playerIds = cRows.map((c) => c.playerId);
    const playerRows = playerIds.length
      ? await db
          .select({ id: players.id, name: players.characterName, fallback: players.discordUsername })
          .from(players)
          .where(inArray(players.id, playerIds))
      : [];
    const playerMap = new Map(playerRows.map((p) => [p.id, p.name ?? p.fallback]));

    const sorted = [...cRows].sort((a, b) => (tally.get(b.playerId) ?? 0) - (tally.get(a.playerId) ?? 0));
    const winner = sorted[0];
    resultHeadline = winner
      ? `**Winner: ${playerMap.get(winner.playerId) ?? winner.playerId}** (${tally.get(winner.playerId) ?? 0} votes)`
      : '*No ballots cast*';

    resultLines = sorted.map((c, i) => {
      const name = playerMap.get(c.playerId) ?? c.playerId;
      const count = tally.get(c.playerId) ?? 0;
      return `${i + 1}. **${name}** — ${count}`;
    });
  } else {
    // Reactions weren't supposed to be enabled for this method — bail safely.
    return;
  }

  // Edit the message
  const channel = await client.channels.fetch(election.discordChannelId);
  if (!channel || !('messages' in channel)) return;

  let msg: Message;
  try {
    msg = await (channel as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(
      election.discordMessageId,
    );
  } catch (error) {
    console.error('[vote-close] vote message no longer exists:', error);
    return;
  }

  const config = election.config ?? {};
  const fields = [
    { name: 'Result', value: resultLines.join('\n') || '*No votes cast*', inline: false },
    { name: 'Total Ballots', value: String(allBallots.length), inline: true },
    { name: 'Type', value: TYPE_LABELS[election.type] ?? election.type, inline: true },
    { name: 'Method', value: METHOD_LABELS[election.method] ?? election.method, inline: true },
  ];

  if (election.method === 'yea_nay_abstain') {
    fields.push({
      name: 'Majority',
      value: formatMajority(config.majorityType, config.passThreshold),
      inline: true,
    });
  }

  const resultEmbed = createEmbed({
    title: election.title,
    description: [
      election.description ? `> ${election.description}\n` : '',
      `**Voting Closed.** ${resultHeadline}`,
    ]
      .filter(Boolean)
      .join('\n'),
    system: 'voting',
    colour: passed === true ? 0x788C5D : passed === false ? 0xC25B4E : 0x6A9BCC,
    fields,
  });

  await msg.edit({ embeds: [resultEmbed] });
}

export default command;
