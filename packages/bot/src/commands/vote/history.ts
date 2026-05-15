import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, and, gte, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { elections } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';

/**
 * /vote history — alias-style shortcut for past, completed votes.
 *
 * The full filter surface lives on /vote list (scope/status/type/range);
 * this command exists because "history" is what most users reach for when
 * they want to look up something that already happened. It defaults to
 * past statuses (certified, cancelled) and the last 30 days, but accepts
 * a `range` to widen the window.
 */

const RESULTS_PER_PAGE = 6;
const MAX_RESULTS = 60;

const PAST_STATUSES = ['certified', 'cancelled'];

// "Past" deliberately doesn't include 'tallied'/'voting_closed' — those
// are still in motion (awaiting NPC confirmation, awaiting certification).
// Use /vote list scope:active for those.

export const HISTORY_TYPE_CHOICES = [
  { name: 'Legislative Vote', value: 'legislative_vote' },
  { name: 'Position Election', value: 'position_election' },
  { name: 'Appointment Confirmation', value: 'appointment_confirmation' },
  { name: 'General Election', value: 'general_election' },
  { name: 'Referendum', value: 'referendum' },
  { name: 'Confidence Vote', value: 'confidence_vote' },
  { name: 'Constitutional Amendment', value: 'constitutional_amendment' },
  { name: 'Party Primary', value: 'party_primary' },
  { name: 'Custom', value: 'custom' },
];

export const HISTORY_RANGE_CHOICES = [
  { name: 'Last 7 days', value: '7' },
  { name: 'Last 30 days', value: '30' },
  { name: 'Last 90 days', value: '90' },
  { name: 'Last year', value: '365' },
  { name: 'All time', value: 'all' },
];

const STATUS_EMOJI: Record<string, string> = {
  certified: '✅',
  cancelled: '❌',
};

function describeOutcome(row: typeof elections.$inferSelect): string {
  const r = row.results;
  if (!r) {
    if (row.status === 'cancelled') return 'cancelled';
    return '—';
  }
  if (row.method === 'yea_nay_abstain') {
    if (r.passed === true) return 'PASSED';
    if (r.passed === false) return 'FAILED';
  }
  if (r.winners && r.winners.length > 0) {
    if (r.winners.length === 1) {
      const w = r.winners[0];
      if (w === 'yea') return 'PASSED';
      if (w === 'nay') return 'FAILED';
      return 'winner picked';
    }
    return `${r.winners.length} winners`;
  }
  return '—';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const range = interaction.options.getString('range') ?? '30';
    const type = interaction.options.getString('type');

    const conditions: SQL[] = [inArray(elections.status, PAST_STATUSES)];

    if (type) {
      conditions.push(eq(elections.type, type));
    }

    if (range !== 'all') {
      const days = parseInt(range, 10);
      if (Number.isFinite(days) && days > 0) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        // For "history" the natural axis is when the vote closed, not when
        // the draft was created — drafts can sit unscheduled for weeks.
        conditions.push(gte(elections.votingClosesAt, since));
      }
    }

    const whereClause = and(...conditions);

    const results = await db
      .select()
      .from(elections)
      .where(whereClause)
      .orderBy(desc(elections.votingClosesAt), desc(elections.createdAt))
      .limit(MAX_RESULTS);

    if (results.length === 0) {
      const rangeLabel = range === 'all' ? 'all time' : `the last ${range} days`;
      const typeLabel = type ? ` (${type.replace(/_/g, ' ')})` : '';
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Vote History',
            description: `No completed votes${typeLabel} in ${rangeLabel}.`,
            system: 'voting',
          }),
        ],
      });
      return;
    }

    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
      const chunk = results.slice(i, i + RESULTS_PER_PAGE);

      const lines = chunk.map((row) => {
        const emoji = STATUS_EMOJI[row.status] ?? '•';
        const outcome = describeOutcome(row);
        const closedAt = row.votingClosesAt ?? row.createdAt;
        const closeStamp = `<t:${Math.floor(closedAt.getTime() / 1000)}:R>`;
        const typeText = row.type.replace(/_/g, ' ');
        return `${emoji} **${row.title}** — *${typeText}*\n  Outcome: \`${outcome}\` — closed ${closeStamp}\n  ID: \`${row.id.slice(0, 8)}\``;
      });

      const filterParts = [
        range !== 'all' ? `Last ${range} days` : 'All time',
        type ? `Type: ${type.replace(/_/g, ' ')}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      pages.push(
        createEmbed({
          title: 'Vote History',
          description: [
            `*${filterParts}*`,
            `Showing **${results.length}** completed vote${results.length !== 1 ? 's' : ''}${results.length === MAX_RESULTS ? ' (max — narrow the range to see more)' : ''}.`,
            '',
            ...lines,
            '',
            'Use `/vote info` with a title for full details, or `/vote list` for active votes.',
          ].join('\n'),
          system: 'voting',
        }),
      );
    }

    await createPaginatedEmbed({ interaction, pages });
}
