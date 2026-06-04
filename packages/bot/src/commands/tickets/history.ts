import type { ChatInputCommandInteraction } from 'discord.js';
import { inArray } from 'drizzle-orm';
import { players } from '@hansard/db';
import { TicketService } from '@hansard/api/services/ticketService';
import type { TicketAuditLogEntry } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { formatTicketPlayer, getTicketViewer } from '../../utils/ticketAccess.js';
import { splitTicketTextForDiscord } from '../../components/ticketButtons.js';
import { db } from '../../db.js';

/**
 * /ticket history <number>
 *
 * Show the full chronological history of a ticket: messages, plus audit log
 * entries (status changes, assignments, etc.) for staff viewers. Visibility
 * mirrors TicketService.getTicket — non-staff only see tickets they created
 * or are assigned to, public replies, and no staff-only notes or audit log.
 */

const MAX_DESCRIPTION_CHARS = 3800;

type ActionRenderer = (entry: TicketAuditLogEntry, actorName: string) => string | null;

const ACTION_RENDERERS: Record<string, ActionRenderer> = {
  created: (_entry, actorName) => `📋 **${actorName}** opened the ticket`,
  status_changed: (entry, actorName) =>
    `🔄 **${actorName}** changed status: \`${String(entry.oldValue)}\` → \`${String(entry.newValue)}\``,
  priority_changed: (entry, actorName) =>
    `⚠️ **${actorName}** changed priority: \`${String(entry.oldValue)}\` → \`${String(entry.newValue)}\``,
  assigned: (_entry, actorName) => `👤 **${actorName}** reassigned the ticket`,
  claimed: (_entry, actorName) => `👤 **${actorName}** claimed the ticket`,
  closed: (_entry, actorName) => `⚫ **${actorName}** closed the ticket`,
  reopened: (_entry, actorName) => `🔵 **${actorName}** reopened the ticket`,
  linked: (_entry, actorName) => `🔗 **${actorName}** linked another ticket`,
  unlinked: (_entry, actorName) => `🔓 **${actorName}** unlinked another ticket`,
  tags_changed: (_entry, actorName) => `🏷️ **${actorName}** updated tags`,
  // commented / internal_note are intentionally skipped: the message body itself
  // is rendered from ticketMessages, so the audit echo would be a duplicate.
};

interface TimelineBlock {
  time: number;
  text: string;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticketNumber = interaction.options.getInteger('number', true);

  await interaction.deferReply({ ephemeral: true });

  const { viewer, isStaff } = await getTicketViewer(interaction);
  const ticket = viewer
    ? await new TicketService(db).getTicketByNumber(ticketNumber, viewer)
    : null;

  if (!ticket) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found or you do not have access.`)],
    });
    return;
  }

  const messages = (ticket.messages ?? []).filter((message) => isStaff || !message.isInternal);
  const auditLog = isStaff ? (ticket.auditLog ?? []) : [];

  const actorIds = [
    ...new Set([
      ...messages.map((message) => message.authorId),
      ...auditLog.map((entry) => entry.actorId),
    ]),
  ];

  const actorRows = actorIds.length
    ? await db
        .select({
          id: players.id,
          discordId: players.discordId,
          characterName: players.characterName,
          discordUsername: players.discordUsername,
        })
        .from(players)
        .where(inArray(players.id, actorIds))
    : [];
  const actorsById = new Map(actorRows.map((row) => [row.id, row]));

  const blocks: TimelineBlock[] = [];

  for (const message of messages) {
    const actor = actorsById.get(message.authorId);
    const authorName = formatTicketPlayer(actor, 'Unknown');
    const time = new Date(message.createdAt).getTime();
    const ts = `<t:${Math.floor(time / 1000)}:f>`;
    const header = message.isInternal
      ? `🔒 **${authorName}** (internal note) • ${ts}`
      : `💬 **${authorName}** • ${ts}`;
    const quoted = message.content
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    blocks.push({ time, text: `${header}\n${quoted}` });
  }

  for (const entry of auditLog) {
    const renderer = ACTION_RENDERERS[entry.action];
    if (!renderer) continue;
    const actor = actorsById.get(entry.actorId);
    const actorName = formatTicketPlayer(actor, 'Unknown');
    const body = renderer(entry, actorName);
    if (!body) continue;
    const time = new Date(entry.createdAt).getTime();
    const ts = `<t:${Math.floor(time / 1000)}:f>`;
    blocks.push({ time, text: `${body} • ${ts}` });
  }

  blocks.sort((a, b) => a.time - b.time);

  if (blocks.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: `Ticket #${ticket.number} History`,
          description: 'No history recorded yet.',
          system: 'tickets',
        }),
      ],
    });
    return;
  }

  const pageBodies: string[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = () => {
    if (buffer.length > 0) {
      pageBodies.push(buffer.join('\n\n'));
      buffer = [];
      bufferLength = 0;
    }
  };

  for (const block of blocks) {
    if (block.text.length > MAX_DESCRIPTION_CHARS) {
      flush();
      for (const chunk of splitTicketTextForDiscord(block.text, MAX_DESCRIPTION_CHARS)) {
        pageBodies.push(chunk);
      }
      continue;
    }
    const separator = buffer.length > 0 ? 2 : 0;
    if (bufferLength + separator + block.text.length > MAX_DESCRIPTION_CHARS) {
      flush();
    }
    buffer.push(block.text);
    bufferLength += (buffer.length > 1 ? 2 : 0) + block.text.length;
  }
  flush();

  const totalEvents = blocks.length;
  const totalPages = pageBodies.length;

  const pages = pageBodies.map((body, index) =>
    createEmbed({
      title: `Ticket #${ticket.number}: ${ticket.title}`,
      description: [
        totalPages > 1
          ? `History — ${totalEvents} event${totalEvents === 1 ? '' : 's'} (part ${index + 1}/${totalPages})`
          : `History — ${totalEvents} event${totalEvents === 1 ? '' : 's'}`,
        '',
        body,
      ].join('\n'),
      system: 'tickets',
    }),
  );

  await createPaginatedEmbed({ interaction, pages });
}
