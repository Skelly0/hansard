import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';

// ============================================================
// Ticket Summary Embed Builder
// ============================================================

const STATUS_DISPLAY: Record<string, string> = {
  open: '\uD83D\uDD35 Open',
  in_progress: '\uD83D\uDFE1 In Progress',
  waiting: '\uD83D\uDFE0 Waiting',
  resolved: '\uD83D\uDFE2 Resolved',
  closed: '\u26AB Closed',
};

const PRIORITY_DISPLAY: Record<string, string> = {
  low: '\u2B07\uFE0F Low',
  normal: '\u2796 Normal',
  high: '\u2B06\uFE0F High',
  urgent: '\uD83D\uDD34 Urgent',
};

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

/**
 * Build the pinned summary embed for a ticket thread.
 */
export function buildTicketSummaryEmbed(data: TicketEmbedData) {
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

  return createEmbed({
    title: `Ticket #${data.number}: ${data.title}`,
    description:
      data.description.length > 400
        ? data.description.slice(0, 400) + '...'
        : data.description,
    system: 'tickets',
    fields,
  });
}

// ============================================================
// Action Row Builder
// ============================================================

/**
 * Build the standard action row for ticket embeds.
 * Buttons: Claim, Close, Set Priority
 */
export function buildTicketActionRow(ticketNumber: number) {
  const claimButton = new ButtonBuilder()
    .setCustomId(`ticket_claim:${ticketNumber}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('\uD83D\uDCCB');

  const closeButton = new ButtonBuilder()
    .setCustomId(`ticket_close:${ticketNumber}`)
    .setLabel('Close')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('\u2716');

  const priorityButton = new ButtonBuilder()
    .setCustomId(`ticket_priority:${ticketNumber}`)
    .setLabel('Priority')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('\u26A0\uFE0F');

  const noteButton = new ButtonBuilder()
    .setCustomId(`ticket_note:${ticketNumber}`)
    .setLabel('Staff Note')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('\uD83D\uDD12');

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

  // TODO: Wire up to DB
  // await ticketService.assignTicket(ticketId, staffDbId, staffDbId);

  await interaction.reply({
    embeds: [
      successEmbed(
        'Ticket Claimed',
        `**Ticket #${ticketNumber}** has been assigned to ${interaction.user}.`,
      ),
    ],
  });
}

// ----------------------------------------------------------
// Close (button)
// ----------------------------------------------------------

async function handleCloseButton(interaction: ButtonInteraction): Promise<void> {
  const ticketNumber = parseTicketNumber(interaction.customId);

  // TODO: Wire up to DB — check permissions (creator or staff)
  // For now, anyone in the thread can close

  // Show the close modal for a resolution note
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');

  const modal = new ModalBuilder()
    .setCustomId(`ticket_close_modal:${ticketNumber}`)
    .setTitle(`Close Ticket #${ticketNumber}`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('close_reason')
    .setLabel('Resolution (optional)')
    .setPlaceholder('Brief description of how this was resolved...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<typeof reasonInput>().addComponents(reasonInput),
  );

  await interaction.showModal(modal);
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
      .setEmoji('\u2B07\uFE0F'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:normal`)
      .setLabel('Normal')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('\u2796'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:high`)
      .setLabel('High')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('\u2B06\uFE0F'),
    new ButtonBuilder()
      .setCustomId(`ticket_set_priority:${ticketNumber}:urgent`)
      .setLabel('Urgent')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('\uD83D\uDD34'),
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

  const parts = interaction.customId.split(':');
  const ticketNumber = parseInt(parts[1], 10);
  const priority = parts[2];

  // TODO: Wire up to DB
  // await ticketService.updateTicket(ticketId, { priority }, actorDbId);

  await interaction.update({
    content: `Priority for Ticket **#${ticketNumber}** set to **${priority}**.`,
    components: [],
  });

  return true;
}

// ============================================================
// Helpers
// ============================================================

function parseTicketNumber(customId: string): number {
  const parts = customId.split(':');
  return parseInt(parts[1], 10);
}
