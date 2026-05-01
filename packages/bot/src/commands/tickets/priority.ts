import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { tickets, ticketAuditLog, players } from '@hansard/db';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /ticket-priority <number> <level>
 *
 * Staff-only. Update the priority of a ticket. Mirrors
 * `TicketService.updateTicket({ priority })` — writes a
 * `priority_changed` audit entry.
 *
 * Schema (`packages/db/src/schema/tickets.ts`) defines priority as
 * varchar(16) with the comment: low, normal, high, urgent.
 */

const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'] as const;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-priority')
    .setDescription('Set a ticket priority level (staff only)')
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('The ticket number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((opt) =>
      opt
        .setName('level')
        .setDescription('Priority level')
        .setRequired(true)
        .addChoices(
          { name: 'Low', value: 'low' },
          { name: 'Normal', value: 'normal' },
          { name: 'High', value: 'high' },
          { name: 'Urgent', value: 'urgent' },
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member) || !(await isStaff(member as any))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can change ticket priority.')],
      });
      return;
    }

    const ticketNumber = interaction.options.getInteger('number', true);
    const level = interaction.options.getString('level', true);

    if (!PRIORITY_LEVELS.includes(level as (typeof PRIORITY_LEVELS)[number])) {
      await interaction.editReply({
        embeds: [errorEmbed(`Invalid priority level: \`${level}\`.`)],
      });
      return;
    }

    // Resolve invoker -> player (actor for audit log)
    const [actorPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!actorPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed('You are not registered as a player.')],
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

    if (ticket.priority === level) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Ticket \`#${ticketNumber}\` already has priority **${level}**.`,
          ),
        ],
      });
      return;
    }

    const oldPriority = ticket.priority;

    await db
      .update(tickets)
      .set({ priority: level, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));

    await db.insert(ticketAuditLog).values({
      ticketId: ticket.id,
      actorId: actorPlayer.id,
      action: 'priority_changed',
      oldValue: oldPriority,
      newValue: level,
    });

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Priority updated',
          [
            `**Ticket:** #${ticketNumber} — ${ticket.title}`,
            `**Priority:** \`${oldPriority}\` -> \`${level}\``,
          ].join('\n'),
        ),
      ],
    });
  },
};

export default command;
