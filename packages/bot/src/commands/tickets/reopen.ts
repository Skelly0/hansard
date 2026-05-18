import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players, ticketAuditLog, ticketMessages, tickets } from '@hansard/db';
import { TicketStatus } from '@hansard/shared';
import { successEmbed, errorEmbed, createEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { db } from '../../db.js';

/**
 * /ticket reopen <number> [reason]
 *
 * Reopens a closed ticket. The ticket creator or any staff member can reopen it.
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

  if (ticket.status !== TicketStatus.CLOSED) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is not closed.`)],
    });
    return;
  }

  const member = interaction.member;
  const actorIsStaff = !!member && (await isStaff(member as any));
  const actorIsCreator = ticket.createdById === actorPlayer.id;

  if (!actorIsStaff && !actorIsCreator) {
    await interaction.editReply({
      embeds: [errorEmbed('Only the ticket creator or a staff member can reopen this ticket.')],
    });
    return;
  }

  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({
          status: TicketStatus.OPEN,
          closedAt: null,
          resolvedAt: null,
          updatedAt: now,
        })
        .where(eq(tickets.id, ticket.id));

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actorPlayer.id,
        action: 'reopened',
        oldValue: TicketStatus.CLOSED,
        newValue: TicketStatus.OPEN,
      });

      if (reason) {
        const [message] = await tx.insert(ticketMessages).values({
          ticketId: ticket.id,
          authorId: actorPlayer.id,
          content: `**Reopened:** ${reason}`,
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
    console.error('Failed to reopen ticket:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to reopen ticket. Please try again.')],
    });
    return;
  }

  const description = [
    `**Ticket:** #${ticketNumber} — ${ticket.title}`,
    `**Reopened by:** ${interaction.user}`,
  ];

  if (reason) {
    description.push(`**Reason:** ${reason}`);
  }

  await interaction.editReply({
    embeds: [successEmbed('Ticket Reopened', description.join('\n'))],
  });

  if (ticket.discordThreadId && interaction.guild) {
    try {
      const thread = await interaction.guild.channels.fetch(ticket.discordThreadId);
      if (thread?.isTextBased()) {
        if ('setArchived' in thread) {
          await (thread as any).setArchived(false, `Ticket #${ticketNumber} reopened`);
        }
        if ('setLocked' in thread) {
          await (thread as any).setLocked(false, `Ticket #${ticketNumber} reopened`);
        }

        const reopenEmbed = createEmbed({
          title: `Ticket #${ticketNumber} Reopened`,
          description: reason
            ? `**Reason:** ${reason}`
            : 'This ticket has been reopened.',
          system: 'tickets',
        });

        await (thread as any).send({
          embeds: [reopenEmbed],
          allowedMentions: { parse: [] },
        });
      }
    } catch {
      // Thread operations failed — not critical.
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
    console.error('Failed to upsert player for ticket reopen:', err);
    return null;
  }
}
