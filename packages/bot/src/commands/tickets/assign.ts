import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players, ticketAuditLog, tickets } from '@hansard/db';
import { TicketStatus } from '@hansard/shared';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { db } from '../../db.js';

/**
 * /ticket assign <number> <user>
 *
 * Assigns a ticket to a staff member. Staff-only command.
 * Updates the ticket status to "in_progress" if currently "open".
 */

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Staff check
  const member = interaction.member;
  if (!member || !(await isStaff(member as any))) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff members can assign tickets.')],
      ephemeral: true,
    });
    return;
  }

  const ticketNumber = interaction.options.getInteger('number', true);
  const assignee = interaction.options.getUser('user', true);

  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply({
      embeds: [errorEmbed('Ticket assignment can only be used in a server.')],
    });
    return;
  }

  let assigneeMember;
  try {
    assigneeMember = await interaction.guild.members.fetch(assignee.id);
  } catch {
    assigneeMember = null;
  }

  if (!assigneeMember || !(await isStaff(assigneeMember as any))) {
    await interaction.editReply({
      embeds: [errorEmbed('Tickets can only be assigned to staff members.')],
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
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is closed and cannot be assigned.`)],
    });
    return;
  }

  const actorPlayer = await upsertPlayer(interaction.user.id, interaction.user.username);
  const assigneePlayer = await upsertPlayer(assignee.id, assignee.username);
  if (!actorPlayer || !assigneePlayer) {
    await interaction.editReply({
      embeds: [errorEmbed('Could not resolve player records for this assignment.')],
    });
    return;
  }

  const oldAssigneeId = ticket.assignedToId;
  const oldStatus = ticket.status;
  const newStatus = ticket.status === TicketStatus.OPEN ? TicketStatus.IN_PROGRESS : ticket.status;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({
          assignedToId: assigneePlayer.id,
          status: newStatus,
          firstResponseAt: ticket.firstResponseAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticket.id));

      await tx.insert(ticketAuditLog).values({
        ticketId: ticket.id,
        actorId: actorPlayer.id,
        action: 'assigned',
        oldValue: oldAssigneeId,
        newValue: assigneePlayer.id,
      });

      if (newStatus !== oldStatus) {
        await tx.insert(ticketAuditLog).values({
          ticketId: ticket.id,
          actorId: actorPlayer.id,
          action: 'status_changed',
          oldValue: oldStatus,
          newValue: newStatus,
        });
      }
    });
  } catch (err) {
    console.error('Failed to assign ticket:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to assign ticket. Please try again.')],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Ticket Assigned',
        [
          `**Ticket:** #${ticketNumber}`,
          `**Assigned to:** ${assignee}`,
          `**By:** ${interaction.user}`,
        ].join('\n'),
      ),
    ],
  });

  // Notify in the ticket thread if one exists
  if (ticket?.discordThreadId && interaction.guild) {
    try {
      const thread = await interaction.guild.channels.fetch(ticket.discordThreadId);
      if (thread?.isTextBased()) {
        await (thread as any).send({
          content: `\uD83D\uDCCB Ticket assigned to ${assignee} by ${interaction.user}.`,
        });
        // Add the assignee to the thread
        if ('members' in thread) {
          await (thread as any).members.add(assignee.id);
        }
      }
    } catch {
      // Thread notification failed — not critical
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
    console.error('Failed to upsert player for ticket assignment:', err);
    return null;
  }
}
