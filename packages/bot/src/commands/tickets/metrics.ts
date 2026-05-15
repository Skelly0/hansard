import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, and, sql, count, avg, gte, isNotNull } from 'drizzle-orm';
import { db } from '../../db.js';
import { tickets, ticketCategories } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

/**
 * /ticket metrics
 *
 * Mirrors GET /api/tickets/metrics — staff dashboard for ticket health.
 * Aggregates from the tickets table.
 */

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply({
      embeds: [errorEmbed('This command must be used in a server.')],
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('You do not have permission to view ticket metrics.')],
    });
    return;
  }

  // Open / In-Progress counts
  const [openResult] = await db
    .select({ value: count() })
    .from(tickets)
    .where(eq(tickets.status, 'open'));
  const openCount = openResult?.value ?? 0;

  const [inProgressResult] = await db
    .select({ value: count() })
    .from(tickets)
    .where(eq(tickets.status, 'in_progress'));
  const inProgressCount = inProgressResult?.value ?? 0;

  // Total tickets created in the last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [weekResult] = await db
    .select({ value: count() })
    .from(tickets)
    .where(gte(tickets.createdAt, oneWeekAgo));
  const totalThisWeek = weekResult?.value ?? 0;

  // Average time-to-first-response (ms) — mirrors ticketService.getMetrics
  const avgResponseRows = await db
    .select({
      value: avg(
        sql`EXTRACT(EPOCH FROM (${tickets.firstResponseAt} - ${tickets.createdAt})) * 1000`,
      ),
    })
    .from(tickets)
    .where(isNotNull(tickets.firstResponseAt));

  const avgResponseTimeMs = avgResponseRows[0]?.value
    ? Math.round(parseFloat(String(avgResponseRows[0].value)))
    : null;

  // Median time-to-close (ms) using PERCENTILE_CONT
  const medianCloseRows = await db
    .select({
      value: sql<string | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${tickets.closedAt} - ${tickets.createdAt})) * 1000)`,
    })
    .from(tickets)
    .where(and(eq(tickets.status, 'closed'), isNotNull(tickets.closedAt)));

  const medianCloseTimeMs = medianCloseRows[0]?.value
    ? Math.round(parseFloat(String(medianCloseRows[0].value)))
    : null;

  // Count by category (joined for category name)
  const byCategoryRows = await db
    .select({
      categoryId: tickets.categoryId,
      categoryName: ticketCategories.name,
      emoji: ticketCategories.emoji,
      value: count(),
    })
    .from(tickets)
    .leftJoin(ticketCategories, eq(tickets.categoryId, ticketCategories.id))
    .groupBy(tickets.categoryId, ticketCategories.name, ticketCategories.emoji);

  // Count by priority
  const byPriorityRows = await db
    .select({ priority: tickets.priority, value: count() })
    .from(tickets)
    .groupBy(tickets.priority);

  const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const PRIORITY_EMOJI: Record<string, string> = {
    urgent: '🔴',
    high: '⬆️',
    normal: '➖',
    low: '⬇️',
  };

  const byPriorityValue =
    byPriorityRows.length > 0
      ? byPriorityRows
          .slice()
          .sort(
            (a, b) =>
              (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
          )
          .map(
            (r) =>
              `${PRIORITY_EMOJI[r.priority] ?? ''} **${r.priority}** — ${r.value}`,
          )
          .join('\n')
      : '_No tickets._';

  const byCategoryValue =
    byCategoryRows.length > 0
      ? byCategoryRows
          .slice()
          .sort((a, b) => Number(b.value) - Number(a.value))
          .map((r) => {
            const label = r.categoryName ?? '_uncategorised_';
            const emoji = r.emoji ? `${r.emoji} ` : '';
            return `${emoji}**${label}** — ${r.value}`;
          })
          .join('\n')
      : '_No tickets._';

  const fields = [
    { name: 'Open', value: `**${openCount}**`, inline: true },
    { name: 'In Progress', value: `**${inProgressCount}**`, inline: true },
    { name: 'Created (7d)', value: `**${totalThisWeek}**`, inline: true },
    {
      name: 'Avg. Time to First Response',
      value: formatDuration(avgResponseTimeMs),
      inline: true,
    },
    {
      name: 'Median Time to Close',
      value: formatDuration(medianCloseTimeMs),
      inline: true,
    },
    { name: '​', value: '​', inline: true },
    { name: 'By Category', value: byCategoryValue, inline: false },
    { name: 'By Priority', value: byPriorityValue, inline: false },
  ];

  const embed = createEmbed({
    title: 'Ticket Metrics',
    system: 'tickets',
    fields,
  });

  await interaction.editReply({ embeds: [embed] });
}
