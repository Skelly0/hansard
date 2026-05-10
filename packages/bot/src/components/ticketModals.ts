import type { ModalSubmitInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players, ticketAuditLog, ticketMessages, tickets } from '@hansard/db';
import { TicketStatus } from '@hansard/shared';
import { successEmbed, errorEmbed, createEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import { db } from '../db.js';

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

  await interaction.deferReply({ ephemeral: true });

  const actor = await upsertPlayer(interaction.user.id, interaction.user.username);
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

  const member = interaction.member;
  const actorIsStaff = !!member && (await isStaff(member as any));
  const actorIsCreator = ticket.createdById === actor.id;
  if (!actorIsStaff && !actorIsCreator) {
    await interaction.editReply({
      embeds: [errorEmbed('Only the ticket creator or a staff member can close this ticket.')],
    });
    return;
  }

  const now = new Date();
  const oldStatus = ticket.status;
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

      if (reason) {
        const [message] = await tx.insert(ticketMessages).values({
          ticketId: ticket.id,
          authorId: actor.id,
          content: `**Resolution:** ${reason}`,
          isInternal: false,
        }).returning();

        await tx.insert(ticketAuditLog).values({
          ticketId: ticket.id,
          actorId: actor.id,
          action: 'commented',
          newValue: { messageId: message.id },
        });
      }
    });
  } catch (err) {
    console.error('Failed to close ticket from modal:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to close ticket. Please try again.')],
    });
    return;
  }

  const description = [`**Ticket:** #${ticketNumber}`, `**Closed by:** ${interaction.user}`];
  if (reason) {
    description.push(`**Resolution:** ${reason}`);
  }

  await interaction.editReply({
    embeds: [successEmbed('Ticket Closed', description.join('\n'))],
  });

  // Post the closure notification to the thread
  const closeChannel = interaction.channel;
  if (closeChannel && 'send' in closeChannel && 'setArchived' in closeChannel) {
    try {
      const closeEmbed = createEmbed({
        title: `Ticket #${ticketNumber} Closed`,
        description: reason ? `**Resolution:** ${reason}` : 'This ticket has been closed.',
        system: 'tickets',
      });

      await closeChannel.send({ embeds: [closeEmbed] });

      // Archive the thread
      await closeChannel.setArchived(true, `Ticket #${ticketNumber} closed`);
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

  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff members can add internal notes.')],
    });
    return;
  }

  const actor = await upsertPlayer(interaction.user.id, interaction.user.username);
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

  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(tickets)
        .set({
          firstResponseAt: ticket.firstResponseAt ?? now,
          updatedAt: now,
        })
        .where(eq(tickets.id, ticket.id));

      const [message] = await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        authorId: actor.id,
        content: note,
        isInternal: true,
      }).returning();

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actor.id,
        action: 'internal_note',
        newValue: { messageId: message.id },
      });
    });
  } catch (err) {
    console.error('Failed to add ticket note from modal:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to add internal note. Please try again.')],
    });
    return;
  }

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
  const noteChannel = interaction.channel;
  if (noteChannel && 'send' in noteChannel) {
    try {
      const noteEmbed = createEmbed({
        title: 'Internal Staff Note Added',
        description: [
          `**By:** ${interaction.user}`,
          '',
          'An internal note was added to the ticket record.',
        ].join('\n'),
        system: 'tickets',
        colour: 0x9C9890, // muted grey for internal notes
      });

      await noteChannel.send({
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

async function upsertPlayer(discordId: string, discordUsername: string) {
  try {
    const [player] = await db
      .insert(players)
      .values({ discordId, discordUsername })
      .onConflictDoUpdate({
        target: players.discordId,
        set: { discordUsername },
      })
      .returning();
    return player ?? null;
  } catch (err) {
    console.error('Failed to upsert player for ticket modal:', err);
    return null;
  }
}
