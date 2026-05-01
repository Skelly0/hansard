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
 * /ticket-link <a> <b>
 *
 * Staff-only. Symmetrically link two tickets together by appending
 * each ticket's UUID to the other's `linkedTicketIds` jsonb array.
 *
 * The schema in `packages/db/src/schema/tickets.ts` defines
 * `linkedTicketIds: jsonb('linked_ticket_ids').$type<string[]>()`,
 * so we use that column rather than a separate join table.
 */

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-link')
    .setDescription('Link two tickets together (staff only)')
    .addIntegerOption((opt) =>
      opt
        .setName('a')
        .setDescription('First ticket number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('b')
        .setDescription('Second ticket number')
        .setRequired(true)
        .setMinValue(1),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member) || !(await isStaff(member as any))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can link tickets.')],
      });
      return;
    }

    const aNumber = interaction.options.getInteger('a', true);
    const bNumber = interaction.options.getInteger('b', true);

    if (aNumber === bNumber) {
      await interaction.editReply({
        embeds: [errorEmbed('Cannot link a ticket to itself.')],
      });
      return;
    }

    // Resolve actor
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

    // Look up both tickets
    const [ticketA] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.number, aNumber))
      .limit(1);

    if (!ticketA) {
      await interaction.editReply({
        embeds: [errorEmbed(`Ticket \`#${aNumber}\` not found.`)],
      });
      return;
    }

    const [ticketB] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.number, bNumber))
      .limit(1);

    if (!ticketB) {
      await interaction.editReply({
        embeds: [errorEmbed(`Ticket \`#${bNumber}\` not found.`)],
      });
      return;
    }

    const aLinks = (ticketA.linkedTicketIds ?? []) as string[];
    const bLinks = (ticketB.linkedTicketIds ?? []) as string[];

    if (aLinks.includes(ticketB.id) && bLinks.includes(ticketA.id)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Tickets \`#${aNumber}\` and \`#${bNumber}\` are already linked.`,
          ),
        ],
      });
      return;
    }

    const now = new Date();
    const newALinks = aLinks.includes(ticketB.id) ? aLinks : [...aLinks, ticketB.id];
    const newBLinks = bLinks.includes(ticketA.id) ? bLinks : [...bLinks, ticketA.id];

    await db
      .update(tickets)
      .set({ linkedTicketIds: newALinks, updatedAt: now })
      .where(eq(tickets.id, ticketA.id));

    await db
      .update(tickets)
      .set({ linkedTicketIds: newBLinks, updatedAt: now })
      .where(eq(tickets.id, ticketB.id));

    // Audit log on both sides
    await db.insert(ticketAuditLog).values({
      ticketId: ticketA.id,
      actorId: actorPlayer.id,
      action: 'linked',
      newValue: { linkedTicketId: ticketB.id, linkedTicketNumber: bNumber },
    });

    await db.insert(ticketAuditLog).values({
      ticketId: ticketB.id,
      actorId: actorPlayer.id,
      action: 'linked',
      newValue: { linkedTicketId: ticketA.id, linkedTicketNumber: aNumber },
    });

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Tickets linked',
          [
            `**#${aNumber}** — ${ticketA.title}`,
            `**#${bNumber}** — ${ticketB.title}`,
          ].join('\n'),
        ),
      ],
    });
  },
};

export default command;
