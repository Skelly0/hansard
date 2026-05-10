import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, and, gte, inArray, ne, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { elections } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const RESULTS_PER_PAGE = 6;
const MAX_RESULTS = 60;

const SCOPE_CHOICES = [
  { name: 'Active (anything in motion)', value: 'active' },
  { name: 'Past (certified or cancelled)', value: 'past' },
  { name: 'All', value: 'all' },
];

const STATUS_CHOICES = [
  { name: 'Draft', value: 'draft' },
  { name: 'Nominations Open', value: 'nominations_open' },
  { name: 'Nominations Closed', value: 'nominations_closed' },
  { name: 'Voting Open', value: 'voting_open' },
  { name: 'Voting Closed', value: 'voting_closed' },
  { name: 'Tallied', value: 'tallied' },
  { name: 'Runoff Needed', value: 'runoff_needed' },
  { name: 'NPC Pending', value: 'npc_pending' },
  { name: 'Certified', value: 'certified' },
  { name: 'Cancelled', value: 'cancelled' },
];

const TYPE_CHOICES = [
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

const RANGE_CHOICES = [
  { name: 'Last 7 days', value: '7' },
  { name: 'Last 30 days', value: '30' },
  { name: 'Last 90 days', value: '90' },
  { name: 'All time', value: 'all' },
];

const ACTIVE_STATUSES = [
  'draft',
  'nominations_open',
  'nominations_closed',
  'voting_open',
  'voting_closed',
  'tallied',
  'runoff_needed',
  'npc_pending',
];

const PAST_STATUSES = ['certified', 'cancelled'];

const STATUS_EMOJI: Record<string, string> = {
  draft: '📝',              // 📝
  nominations_open: '👥',   // 👥
  nominations_closed: '🔒', // 🔒
  voting_open: '🗳️',  // 🗳️
  voting_closed: '⏱️',      // ⏱️
  tallied: '📊',            // 📊
  runoff_needed: '♻️',      // ♻️
  npc_pending: '⏳',              // ⏳
  certified: '✅',                // ✅
  cancelled: '❌',                // ❌
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function describeOutcome(row: typeof elections.$inferSelect): string {
  const r = row.results;
  if (!r) {
    if (row.status === 'cancelled') return 'cancelled';
    return '';
  }
  if (row.method === 'yea_nay_abstain') {
    if (r.passed === true) return 'passed';
    if (r.passed === false) return 'failed';
  }
  if (r.winners && r.winners.length > 0) {
    if (r.winners.length === 1) return `winner: ${r.winners[0] === 'yea' || r.winners[0] === 'nay' ? r.winners[0] : 'picked'}`;
    return `${r.winners.length} winners`;
  }
  if (r.runoffTriggered) return 'runoff';
  return '';
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-list')
    .setDescription('Browse votes and elections — past or present')
    .addStringOption((opt) =>
      opt
        .setName('scope')
        .setDescription('Active, past, or all (default: all)')
        .setRequired(false)
        .addChoices(...SCOPE_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName('status')
        .setDescription('Filter by exact status (overrides scope)')
        .setRequired(false)
        .addChoices(...STATUS_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Filter by election type')
        .setRequired(false)
        .addChoices(...TYPE_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName('range')
        .setDescription('Limit to votes created within a time window')
        .setRequired(false)
        .addChoices(...RANGE_CHOICES),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const scope = (interaction.options.getString('scope') ?? 'all') as 'active' | 'past' | 'all';
    const status = interaction.options.getString('status');
    const type = interaction.options.getString('type');
    const range = interaction.options.getString('range') ?? 'all';
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));

    const conditions: SQL[] = [];
    if (!actorIsStaff) {
      conditions.push(ne(elections.status, 'draft'));
    }

    if (status) {
      conditions.push(eq(elections.status, status));
    } else if (scope === 'active') {
      conditions.push(inArray(elections.status, ACTIVE_STATUSES));
    } else if (scope === 'past') {
      conditions.push(inArray(elections.status, PAST_STATUSES));
    }

    if (type) {
      conditions.push(eq(elections.type, type));
    }

    if (range !== 'all') {
      const days = parseInt(range, 10);
      if (Number.isFinite(days) && days > 0) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        conditions.push(gte(elections.createdAt, since));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Order by recency: prefer voting close (most natural for past votes)
    // and fall back to creation timestamp for drafts that have no close yet.
    const results = whereClause
      ? await db
          .select()
          .from(elections)
          .where(whereClause)
          .orderBy(desc(elections.votingClosesAt), desc(elections.createdAt))
          .limit(MAX_RESULTS)
      : await db
          .select()
          .from(elections)
          .orderBy(desc(elections.votingClosesAt), desc(elections.createdAt))
          .limit(MAX_RESULTS);

    if (results.length === 0) {
      const filterDesc = [
        status ? `status: **${statusLabel(status)}**` : null,
        !status && scope !== 'all' ? `scope: **${scope}**` : null,
        type ? `type: **${type.replace(/_/g, ' ')}**` : null,
        range !== 'all' ? `last **${range} days**` : null,
      ]
        .filter(Boolean)
        .join(', ');

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Votes',
            description: filterDesc
              ? `No votes match ${filterDesc}.`
              : 'No votes have been recorded yet.',
            system: 'voting',
          }),
        ],
      });
      return;
    }

    // Build paginated embeds — one chunk per page.
    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
      const chunk = results.slice(i, i + RESULTS_PER_PAGE);

      const lines = chunk.map((row) => {
        const emoji = STATUS_EMOJI[row.status] ?? '•';
        const outcome = describeOutcome(row);
        const closeStamp = row.votingClosesAt
          ? `<t:${Math.floor(row.votingClosesAt.getTime() / 1000)}:R>`
          : `<t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`;
        const tags = [
          statusLabel(row.status),
          row.roundNumber > 1 ? `R${row.roundNumber}` : null,
          outcome ? `*${outcome}*` : null,
        ]
          .filter(Boolean)
          .join(' — ');
        return `${emoji} **${row.title}**\n  ${tags}\n  \`${row.id.slice(0, 8)}\` — closes ${closeStamp}`;
      });

      const filterParts = [
        status ? `Status: ${statusLabel(status)}` : null,
        !status && scope !== 'all' ? `Scope: ${scope}` : null,
        type ? `Type: ${type.replace(/_/g, ' ')}` : null,
        range !== 'all' ? `Last ${range} days` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      pages.push(
        createEmbed({
          title: 'Votes',
          description: [
            filterParts ? `*${filterParts}*` : null,
            `Showing **${results.length}** vote${results.length !== 1 ? 's' : ''}${results.length === MAX_RESULTS ? ' (max — narrow the filter to see older ones)' : ''}.`,
            '',
            ...lines,
            '',
            'Use `/vote-info` with a title or ID for full details.',
          ]
            .filter((l) => l !== null)
            .join('\n'),
          system: 'voting',
        }),
      );
    }

    await createPaginatedEmbed({ interaction, pages });
  },
};

export default command;
