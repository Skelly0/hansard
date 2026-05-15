import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players, ticketAuditLog, ticketMessages, tickets } from '@hansard/db';
import { TicketStatus } from '@hansard/shared';
import { successEmbed, errorEmbed, createEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { db } from '../../db.js';

/**
 * /ticket close <number> [reason]
 *
 * Closes a ticket with an optional resolution note.
 * The ticket creator or any staff member can close a ticket.
 */

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticketNumber = interaction.options.getInteger('number', true);
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ ephemeral: true });

  const actorPlayer = await upsertPlayer(interaction.user.id, interaction.user.username);
  if (!actorPlayer) {
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
  const actorIsCreator = ticket.createdById === actorPlayer.id;

  if (!actorIsStaff && !actorIsCreator) {
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
        actorId: actorPlayer.id,
        action: 'closed',
        oldValue: oldStatus,
        newValue: TicketStatus.CLOSED,
      });

      if (reason) {
        const [message] = await tx.insert(ticketMessages).values({
          ticketId: ticket.id,
          authorId: actorPlayer.id,
          content: `**Resolution:** ${reason}`,
          isInternal: false,
        }).returning();

        await tx.insert(ticketAuditLog).values({
          ticketId: ticket.id,
          actorId: actorPlayer.id,
          action: 'commented',
          newValue: { messageId: message.id },
        });
      }
    });
  } catch (err) {
    console.error('Failed to close ticket:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to close ticket. Please try again.')],
    });
    return;
  }

  const description = [
    `**Ticket:** #${ticketNumber} — ${ticket.title}`,
    `**Closed by:** ${interaction.user}`,
  ];

  if (reason) {
    description.push(`**Resolution:** ${reason}`);
  }

  await interaction.editReply({
    embeds: [successEmbed('Ticket Closed', description.join('\n'))],
  });

  // Notify and archive the thread
  if (ticket?.discordThreadId && interaction.guild) {
    try {
      const thread = await interaction.guild.channels.fetch(ticket.discordThreadId);
      if (thread?.isTextBased()) {
        const closeEmbed = createEmbed({
          title: `Ticket #${ticketNumber} Closed`,
          description: reason
            ? `**Resolution:** ${reason}`
            : 'This ticket has been closed.',
          system: 'tickets',
        });

        await (thread as any).send({ embeds: [closeEmbed] });

        // Archive the thread
        if ('setArchived' in thread) {
          await (thread as any).setArchived(true, `Ticket #${ticketNumber} closed`);
        }
      }
    } catch {
      // Thread operations failed — not critical
    }
  }
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
    console.error('Failed to upsert player for ticket close:', err);
    return null;
  }
}
