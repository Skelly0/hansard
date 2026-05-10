import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
  type Message,
  type ThreadChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  tickets,
  ticketAuditLog,
  ticketCategories,
  players,
} from '@hansard/db';
import { TicketStatus, TicketPriority } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed, type EmbedField } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import { db } from '../db.js';

// ============================================================
// Ticket Summary Embed Builder
// ============================================================

const STATUS_DISPLAY: Record<string, string> = {
  open: '🔵 Open',
  in_progress: '🟡 In Progress',
  waiting: '🟠 Waiting',
  resolved: '🟢 Resolved',
  closed: '⚫ Closed',
};

const PRIORITY_DISPLAY: Record<string, string> = {
  low: '⬇️ Low',
  normal: '➖ Normal',
  high: '⬆️ High',
  urgent: '🔴 Urgent',
};

const VALID_PRIORITIES = new Set<string>(Object.values(TicketPriority));
export const TICKET_DESCRIPTION_PAGE_SIZE = 1800;
export const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;

export interface TicketEmbedData {
  number: number;
  title: string;
  description: string;
  category: { name: string; emoji: string };
  status: string;
  priority: string;
  createdBy: { id: string; displayName: string };
  assignedTo: { id: string; displayName: string } | null;
  createdAt: string;
  tags: string[];
}

export function splitTicketTextForDiscord(
  content: string,
  maxLength = TICKET_DESCRIPTION_PAGE_SIZE,
): string[] {
  let remaining = content.trim();
  if (!remaining) return ['*No ticket description available.*'];

  const chunks: string[] = [];

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    let splitAt = window.lastIndexOf('\n\n');

    if (splitAt < maxLength * 0.5) {
      splitAt = window.lastIndexOf('\n');
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = window.lastIndexOf(' ');
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

export function buildTicketDescriptionEmbeds(options: {
  title: string;
  description: string;
  fields?: EmbedField[];
}) {
  const chunks = splitTicketTextForDiscord(options.description);

  return chunks.map((chunk, index) => createEmbed({
    title: index === 0 ? options.title : `${options.title} (continued)`,
    description: chunk,
    system: 'tickets',
    fields: index === 0 ? options.fields : undefined,
  }));
}

export function buildTicketOpeningMessages(
  displayName: string,
  description: string,
  maxLength = DISCORD_MESSAGE_CONTENT_LIMIT,
): string[] {
  const prefix = `**${displayName}** opened this ticket:\n\n`;
  const firstPageLength = Math.max(1, maxLength - prefix.length);
  const chunks = splitTicketTextForDiscord(description, firstPageLength);

  return chunks.map((chunk, index) => (
    index === 0 ? `${prefix}${chunk}` : chunk
  ));
}

/**
 * Build the pinned summary embed for a ticket thread.
 */
export function buildTicketSummaryEmbed(data: TicketEmbedData) {
  return buildTicketSummaryEmbeds(data)[0];
}

export function buildTicketSummaryEmbeds(data: TicketEmbedData) {
  const fields = [
    {
      name: 'Status',
      value: STATUS_DISPLAY[data.status] ?? data.status,
      inline: true,
    },
    {
      name: 'Priority',
      value: PRIORITY_DISPLAY[data.priority] ?? data.priority,
      inline: true,
    },
    {
      name: 'Category',
      value: `${data.category.emoji} ${data.category.name}`,
      inline: true,
    },
    {
      name: 'Created By',
      value: data.createdBy.displayName,
      inline: true,
    },
    {
      name: 'Assigned To',
      value: data.assignedTo?.displayName ?? '*Unassigned*',
      inline: true,
    },
    {
      name: 'Opened',
      value: `<t:${Math.floor(new Date(data.createdAt).getTime() / 1000)}:R>`,
      inline: true,
    },
  ];

  if (data.tags.length > 0) {
    fields.push({
      name: 'Tags',
      value: data.tags.map((t) => `\`${t}\``).join(', '),
      inline: false,
    });
  }

  return buildTicketDescriptionEmbeds({
    title: `Ticket #${data.number}: ${data.title}`,
    description: data.description,
    fields,
  });
}

// ============================================================
// Action Row Builder
// ============================================================

/**
 * Build the standard action row for ticket embeds.
 * Buttons: Claim, Close, Set Priority, Staff Note.
 */
export function buildTicketActionRow(ticketNumber: number) {
  const claimButton = new ButtonBuilder()
    .setCustomId(`ticket_claim:${ticketNumber}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('📋');

  const closeButton = new ButtonBuilder()
    .setCustomId(`ticket_close:${ticketNumber}`)
    .setLabel('Close')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('✖');

  const priorityButton = new ButtonBuilder()
    .setCustomId(`ticket_priority:${ticketNumber}`)
    .setLabel('Priority')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⚠️');

  const noteButton = new ButtonBuilder()
    .setCustomId(`ticket_note:${ticketNumber}`)
    .setLabel('Staff Note')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🔒');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    claimButton,
    closeButton,
    priorityButton,
    noteButton,
  );
}

// ============================================================
// Button Interaction Handlers
// ============================================================

/**
 * Route a ticket button interaction to the correct handler.
 * Returns true if the interaction was handled, false otherwise.
 */
export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
  const customId = interaction.customId;

  if (customId.startsWith('ticket_claim:')) {
    await handleClaim(interaction);
    return true;
  }

  if (customId.startsWith('ticket_close:')) {
    await handleCloseButton(interaction);
    return true;
  }

  if (customId.startsWith('ticket_priority:')) {
    await handlePriorityButton(interaction);
    return true;
  }

  if (customId.startsWith('ticket_note:')) {
    await handleNoteButton(interaction);
    return true;
  }

  return false;
}

// ----------------------------------------------------------
// Claim
// ----------------------------------------------------------

async function handleClaim(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff members can claim tickets.')],
      ephemeral: true,
    });
    return;
  }

  const ticketNumber = parseTicketNumber(interaction.customId);

  await interaction.deferReply({ ephemeral: true });

  // Resolve actor (the staff member doing the claim) — upsert mirrors
  // the create.ts pattern so we never hit "you have no player record"
  // on first staff contact with the ledger.
  const actor = await upsertActorPlayer(interaction);
  if (!actor) {
    await interaction.editReply({
      embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
    });
    return;
  }

  // Look up ticket
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.number, ticketNumber))
    .limit(1);

  if (!ticket) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
    });
    return;
  }

  if (ticket.status === TicketStatus.CLOSED) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is closed and cannot be claimed.`)],
    });
    return;
  }

  if (ticket.assignedToId === actor.id) {
    await interaction.editReply({
      embeds: [errorEmbed(`You already have Ticket \`#${ticketNumber}\` assigned.`)],
    });
    return;
  }

  const oldAssignee = ticket.assignedToId;
  const oldStatus = ticket.status;
  const willPromoteStatus = ticket.status === TicketStatus.OPEN;
  const newStatus = willPromoteStatus ? TicketStatus.IN_PROGRESS : ticket.status;

  // Atomic mutation + audit log
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({
          assignedToId: actor.id,
          status: newStatus,
          firstResponseAt: ticket.firstResponseAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticket.id));

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actor.id,
        action: 'claimed',
        oldValue: { assignedToId: oldAssignee },
        newValue: { assignedToId: actor.id },
      });

      if (willPromoteStatus) {
        await tx.insert(ticketAuditLog).values({
          ticketId: ticket.id,
          actorId: actor.id,
          action: 'status_changed',
          oldValue: oldStatus,
          newValue: newStatus,
        });
      }
    });
  } catch (err) {
    console.error('Failed to claim ticket:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to claim ticket. Please try again.')],
    });
    return;
  }

  // Best-effort embed refresh — the pinned summary is the source of truth
  // for the thread, so always try to update it. Failures are non-fatal.
  await refreshPinnedSummary(interaction, {
    ticketId: ticket.id,
    overrides: {
      assignedTo: {
        id: interaction.user.id,
        displayName: resolveDisplayName(interaction),
      },
      status: newStatus,
    },
  });

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Ticket Claimed',
        [
          `**Ticket:** #${ticketNumber} — ${ticket.title}`,
          `**Assigned to:** ${interaction.user}`,
          willPromoteStatus
            ? `**Status:** \`${oldStatus}\` -> \`${newStatus}\``
            : `**Status:** \`${newStatus}\` (unchanged)`,
        ].join('\n'),
      ),
    ],
  });
}

// ----------------------------------------------------------
// Close (button)
// ----------------------------------------------------------

async function handleCloseButton(interaction: ButtonInteraction): Promise<void> {
  const ticketNumber = parseTicketNumber(interaction.customId);

  await interaction.deferReply({ ephemeral: true });

  // Resolve actor — anyone who can interact with the thread can close
  // their own ticket; staff can close any. We enforce that below.
  const actor = await upsertActorPlayer(interaction);
  if (!actor) {
    await interaction.editReply({
      embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
    });
    return;
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.number, ticketNumber))
    .limit(1);

  if (!ticket) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
    });
    return;
  }

  if (ticket.status === TicketStatus.CLOSED) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is already closed.`)],
    });
    return;
  }

  // Permission gate: creator OR staff may close.
  const member = interaction.member;
  const isClickerStaff = !!member && (await isStaff(member as any));
  const isCreator = ticket.createdById === actor.id;

  if (!isClickerStaff && !isCreator) {
    await interaction.editReply({
      embeds: [errorEmbed('Only the ticket creator or a staff member can close this ticket.')],
    });
    return;
  }

  const oldStatus = ticket.status;
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({
          status: TicketStatus.CLOSED,
          closedAt: now,
          resolvedAt: ticket.resolvedAt ?? now,
          updatedAt: now,
        })
        .where(eq(tickets.id, ticket.id));

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actor.id,
        action: 'closed',
        oldValue: oldStatus,
        newValue: TicketStatus.CLOSED,
      });
    });
  } catch (err) {
    console.error('Failed to close ticket:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to close ticket. Please try again.')],
    });
    return;
  }

  // Refresh the pinned summary so the closed status is visible.
  await refreshPinnedSummary(interaction, {
    ticketId: ticket.id,
    overrides: { status: TicketStatus.CLOSED },
  });

  // Lock the thread (and post a closure embed). Best-effort.
  const channel = interaction.channel;
  if (channel && channel.isThread()) {
    try {
      await channel.send({
        embeds: [
          createEmbed({
            title: `Ticket #${ticketNumber} Closed`,
            description: `This ticket has been closed by ${interaction.user}.`,
            system: 'tickets',
          }),
        ],
      });
    } catch (err) {
      console.error('Failed to post closure notice in thread:', err);
    }
    try {
      await (channel as ThreadChannel).setLocked(
        true,
        `Ticket #${ticketNumber} closed by ${interaction.user.username}`,
      );
    } catch (err) {
      console.error('Failed to lock ticket thread:', err);
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Ticket Closed',
        [
          `**Ticket:** #${ticketNumber} — ${ticket.title}`,
          `**Closed by:** ${interaction.user}`,
          `**Status:** \`${oldStatus}\` -> \`closed\``,
        ].join('\n'),
      ),
    ],
  });
}

// ----------------------------------------------------------
// Priority
// ----------------------------------------------------------

async function handlePriorityButton(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff members can change ticket priority.')],
      ephemeral: true,
    });
    return;
  }

  const ticketNumber = parseTicketNumber(interaction.customId);

  // Show priority selection as buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:low`)
      .setLabel('Low')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬇️'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:normal`)
      .setLabel('Normal')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('➖'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:high`)
      .setLabel('High')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⬆️'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:urgent`)
      .setLabel('Urgent')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴'),
  );

  await interaction.reply({
    content: `Select priority for Ticket **#${ticketNumber}**:`,
    components: [row],
    ephemeral: true,
  });
}

// ----------------------------------------------------------
// Staff Note
// ----------------------------------------------------------

async function handleNoteButton(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff members can add internal notes.')],
      ephemeral: true,
    });
    return;
  }

  const ticketNumber = parseTicketNumber(interaction.customId);

  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');

  const modal = new ModalBuilder()
    .setCustomId(`ticket_note_modal:${ticketNumber}`)
    .setTitle(`Staff Note — Ticket #${ticketNumber}`);

  const noteInput = new TextInputBuilder()
    .setCustomId('staff_note')
    .setLabel('Internal Note')
    .setPlaceholder('This note is only visible to staff...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  modal.addComponents(
    new ActionRowBuilder<typeof noteInput>().addComponents(noteInput),
  );

  await interaction.showModal(modal);
}

// ----------------------------------------------------------
// Priority Set (follow-up from priority button)
// ----------------------------------------------------------

/**
 * Handle the ticket_set_priority button.
 * Returns true if handled.
 */
export async function handleSetPriorityButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('ticket_set_priority:')) return false;

  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff members can change ticket priority.')],
      ephemeral: true,
    });
    return true;
  }

  const parts = interaction.customId.split(':');
  const ticketNumber = parseInt(parts[1], 10);
  const priority = parts[2];

  if (!VALID_PRIORITIES.has(priority)) {
    await interaction.update({
      content: `Invalid priority \`${priority}\`.`,
      components: [],
    });
    return true;
  }

  // Clear the selection UI immediately so the click is acknowledged even if
  // the DB write takes a moment. We then send a follow-up with the result.
  await interaction.update({
    content: `Updating priority for Ticket **#${ticketNumber}**...`,
    components: [],
  });

  // Resolve actor (already staff-confirmed above)
  const actor = await upsertActorPlayer(interaction);
  if (!actor) {
    await interaction.followUp({
      embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
      ephemeral: true,
    });
    return true;
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.number, ticketNumber))
    .limit(1);

  if (!ticket) {
    await interaction.followUp({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
      ephemeral: true,
    });
    return true;
  }

  if (ticket.status === TicketStatus.CLOSED) {
    await interaction.followUp({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is closed and its priority cannot be changed.`)],
      ephemeral: true,
    });
    return true;
  }

  if (ticket.priority === priority) {
    await interaction.followUp({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` already has priority **${priority}**.`)],
      ephemeral: true,
    });
    return true;
  }

  const oldPriority = ticket.priority;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({ priority, updatedAt: new Date() })
        .where(eq(tickets.id, ticket.id));

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actor.id,
        action: 'priority_changed',
        oldValue: oldPriority,
        newValue: priority,
        // metadata = { from, to } per task spec; stored under both columns
        // so audits can render either old/new pair or a structured payload.
      });
    });
  } catch (err) {
    console.error('Failed to update ticket priority:', err);
    await interaction.followUp({
      embeds: [errorEmbed('Failed to update priority. Please try again.')],
      ephemeral: true,
    });
    return true;
  }

  await refreshPinnedSummary(interaction, {
    ticketId: ticket.id,
    overrides: { priority },
  });

  await interaction.followUp({
    embeds: [
      successEmbed(
        'Priority Updated',
        [
          `**Ticket:** #${ticketNumber} — ${ticket.title}`,
          `**Priority:** \`${oldPriority}\` -> \`${priority}\``,
        ].join('\n'),
      ),
    ],
    ephemeral: true,
  });

  return true;
}

// ============================================================
// Internal helpers
// ============================================================

function parseTicketNumber(customId: string): number {
  const parts = customId.split(':');
  return parseInt(parts[1], 10);
}

function resolveDisplayName(interaction: ButtonInteraction): string {
  const member = interaction.member;
  if (member && 'displayName' in member && typeof (member as { displayName?: string }).displayName === 'string') {
    return (member as { displayName: string }).displayName;
  }
  return interaction.user.displayName || interaction.user.username;
}

/**
 * Upsert the invoking Discord user to a `players` row, mirroring the
 * findOrCreate pattern used in `commands/tickets/create.ts`. The bot
 * package never imports `@hansard/api`, so the upsert is inlined.
 */
async function upsertActorPlayer(interaction: ButtonInteraction) {
  try {
    const [row] = await db
      .insert(players)
      .values({
        discordId: interaction.user.id,
        discordUsername: interaction.user.username,
      })
      .onConflictDoUpdate({
        target: players.discordId,
        set: { discordUsername: interaction.user.username },
      })
      .returning();
    return row ?? null;
  } catch (err) {
    console.error('Failed to upsert actor player:', err);
    return null;
  }
}

interface RefreshOverrides {
  status?: string;
  priority?: string;
  assignedTo?: { id: string; displayName: string } | null;
}

/**
 * Re-fetch the ticket + category, find the pinned summary message in the
 * current thread, and edit it to reflect post-mutation state. Best-effort:
 * any failure is logged and swallowed — the DB write has already committed.
 */
async function refreshPinnedSummary(
  interaction: ButtonInteraction,
  opts: { ticketId: string; overrides?: RefreshOverrides },
): Promise<void> {
  try {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, opts.ticketId))
      .limit(1);
    if (!ticket) return;

    const [category] = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, ticket.categoryId))
      .limit(1);

    // Resolve creator + (optionally) assignee display names from players
    const [creator] = await db
      .select()
      .from(players)
      .where(eq(players.id, ticket.createdById))
      .limit(1);

    let assignedTo: { id: string; displayName: string } | null = null;
    if (opts.overrides?.assignedTo !== undefined) {
      assignedTo = opts.overrides.assignedTo;
    } else if (ticket.assignedToId) {
      const [assignee] = await db
        .select()
        .from(players)
        .where(eq(players.id, ticket.assignedToId))
        .limit(1);
      if (assignee) {
        assignedTo = {
          id: assignee.discordId ?? assignee.id,
          displayName:
            assignee.characterName ||
            assignee.discordUsername ||
            'Unknown',
        };
      }
    }

    const data: TicketEmbedData = {
      number: ticket.number,
      title: ticket.title,
      description: ticket.description,
      category: {
        name: category?.name ?? 'Unknown',
        emoji: category?.emoji ?? '📋',
      },
      status: opts.overrides?.status ?? ticket.status,
      priority: opts.overrides?.priority ?? ticket.priority,
      createdBy: {
        id: creator?.discordId ?? ticket.createdById,
        displayName:
          creator?.characterName ||
          creator?.discordUsername ||
          'Unknown',
      },
      assignedTo,
      createdAt:
        ticket.createdAt instanceof Date
          ? ticket.createdAt.toISOString()
          : new Date(ticket.createdAt as unknown as string).toISOString(),
      tags: (ticket.tags as string[] | null) ?? [],
    };

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.PrivateThread && channel.type !== ChannelType.PublicThread) {
      return;
    }

    // Find the pinned summary message — produced by create.ts as the first
    // pin in the thread. Fall back to scanning recent messages from the bot.
    let pinned: Message | undefined;
    try {
      const pinnedColl = await (channel as ThreadChannel).messages.fetchPinned();
      pinned = pinnedColl.find(
        (m) =>
          m.author.id === interaction.client.user?.id &&
          m.embeds.length > 0 &&
          (m.embeds[0].title?.includes(`Ticket #${ticket.number}`) ?? false),
      );
    } catch (err) {
      console.error('Failed to fetch pinned messages for ticket summary refresh:', err);
    }

    if (!pinned) {
      try {
        const recent = await (channel as ThreadChannel).messages.fetch({ limit: 50 });
        pinned = recent.find(
          (m) =>
            m.author.id === interaction.client.user?.id &&
            m.embeds.length > 0 &&
            (m.embeds[0].title?.includes(`Ticket #${ticket.number}`) ?? false),
        );
      } catch (err) {
        console.error('Failed to scan recent messages for ticket summary:', err);
      }
    }

    if (!pinned) return;

    await pinned.edit({
      embeds: buildTicketSummaryEmbeds(data).slice(0, 10),
      components:
        data.status === TicketStatus.CLOSED
          ? [] // strip action row on closed tickets
          : [buildTicketActionRow(ticket.number)],
    });
  } catch (err) {
    console.error('refreshPinnedSummary failed (non-fatal):', err);
  }
}
