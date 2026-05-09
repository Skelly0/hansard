import type { ModalSubmitInteraction } from 'discord.js';
import { successEmbed, errorEmbed, createEmbed } from '../utils/embeds.js';

/**
 * Route a ticket-related modal submission to the correct handler.
 * Returns true if the interaction was handled, false otherwise.
 */
export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const customId = interaction.customId;

  if (customId.startsWith('ticket_close_modal:')) {
    await handleCloseModal(interaction);
    return true;
  }

  if (customId.startsWith('ticket_note_modal:')) {
    await handleNoteModal(interaction);
    return true;
  }

  return false;
}

// ----------------------------------------------------------
// Close Modal
// ----------------------------------------------------------

async function handleCloseModal(interaction: ModalSubmitInteraction): Promise<void> {
  const ticketNumber = parseTicketNumber(interaction.customId);
  const reason = interaction.fields.getTextInputValue('close_reason') || null;

  await interaction.deferReply();

  // TODO: Wire up to DB
  // const ticket = await ticketService.getTicketByNumber(ticketNumber);
  // await ticketService.closeTicket(ticket.id, reason, actorDbId);

  const description = [`**Ticket:** #${ticketNumber}`, `**Closed by:** ${interaction.user}`];
  if (reason) {
    description.push(`**Resolution:** ${reason}`);
  }

  await interaction.editReply({
    embeds: [successEmbed('Ticket Closed', description.join('\n'))],
  });

  // Post the closure notification to the thread
  const channel = interaction.channel;
  if (channel && 'send' in channel && 'setArchived' in (channel as any)) {
    try {
      const closeEmbed = createEmbed({
        title: `Ticket #${ticketNumber} Closed`,
        description: reason ? `**Resolution:** ${reason}` : 'This ticket has been closed.',
        system: 'tickets',
      });

      await channel.send({ embeds: [closeEmbed] });

      // Archive the thread
      await (channel as any).setArchived(true, `Ticket #${ticketNumber} closed`);
    } catch {
      // Thread operations failed — not critical
    }
  }
}

// ----------------------------------------------------------
// Staff Note Modal
// ----------------------------------------------------------

async function handleNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
  const ticketNumber = parseTicketNumber(interaction.customId);
  const note = interaction.fields.getTextInputValue('staff_note');

  await interaction.deferReply({ ephemeral: true });

  // TODO: Wire up to DB
  // const ticket = await ticketService.getTicketByNumber(ticketNumber);
  // await ticketService.addMessage(ticket.id, note, actorDbId, true);

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Staff Note Added',
        [
          `**Ticket:** #${ticketNumber}`,
          `**Note by:** ${interaction.user}`,
          '',
          `> ${note.split('\n').join('\n> ')}`,
        ].join('\n'),
      ),
    ],
  });

  // Post internal note indicator to the thread (visible to staff)
  const channel = interaction.channel;
  if (channel && 'send' in channel) {
    try {
      const noteEmbed = createEmbed({
        title: 'Internal Staff Note',
        description: [
          `**By:** ${interaction.user}`,
          '',
          note,
        ].join('\n'),
        system: 'tickets',
        colour: 0x9C9890, // muted grey for internal notes
      });

      await channel.send({
        embeds: [noteEmbed],
        // In production, this would check if the channel is the ticket
        // thread and only visible to staff. For now, it's sent to the thread.
      });
    } catch {
      // Not critical
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function parseTicketNumber(customId: string): number {
  const parts = customId.split(':');
  return parseInt(parts[1], 10);
}
