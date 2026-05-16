import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, or, desc, count, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import {
  tickets,
  elections,
  players,
  bills,
  modActions,
  simulationClock,
} from '@hansard/db';
import { createEmbed, errorEmbed } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';
import type { Command } from '../client.js';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('At-a-glance overview of the simulation (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({
        embeds: [errorEmbed('This command must be used in a server.')],
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaff(member))) {
      await interaction.editReply({
        embeds: [errorEmbed('You do not have permission to view the dashboard.')],
      });
      return;
    }

    // Mirrors GET /api/dashboard/overview

    // Open tickets (any non-closed status)
    const [ticketResult] = await db
      .select({ value: count() })
      .from(tickets)
      .where(
        or(
          eq(tickets.status, 'open'),
          eq(tickets.status, 'in_progress'),
          eq(tickets.status, 'waiting'),
          eq(tickets.status, 'resolved'),
        ),
      );
    const openTickets = ticketResult?.value ?? 0;

    // Active elections (voting_open or draft)
    const [electionResult] = await db
      .select({ value: count() })
      .from(elections)
      .where(or(eq(elections.status, 'voting_open'), eq(elections.status, 'draft')));
    const activeElections = electionResult?.value ?? 0;

    // Pending bills (submitted or voting)
    const [billResult] = await db
      .select({ value: count() })
      .from(bills)
      .where(or(eq(bills.status, 'submitted'), eq(bills.status, 'voting')));
    const pendingBills = billResult?.value ?? 0;

    // Active players
    const [playerResult] = await db
      .select({ value: count() })
      .from(players)
      .where(and(eq(players.isActive, true), eq(players.isAlive, true)));
    const activePlayers = playerResult?.value ?? 0;

    // Active mod actions
    const [modResult] = await db
      .select({ value: count() })
      .from(modActions)
      .where(eq(modActions.isActive, true));
    const activeModActions = modResult?.value ?? 0;

    // Simulation clock
    const [clock] = await db.select().from(simulationClock).limit(1);

    // Recent mod activity (last 5)
    const recentMod = await db
      .select({
        type: modActions.type,
        createdAt: modActions.createdAt,
        moderatorId: modActions.moderatorId,
        targetPlayerId: modActions.targetPlayerId,
      })
      .from(modActions)
      .orderBy(desc(modActions.createdAt))
      .limit(5);

    const playerIds = new Set<string>();
    for (const m of recentMod) {
      playerIds.add(m.moderatorId);
      playerIds.add(m.targetPlayerId);
    }

    const nameMap = new Map<string, string>();
    if (playerIds.size > 0) {
      const rows = await db
        .select({
          id: players.id,
          characterName: players.characterName,
          discordUsername: players.discordUsername,
        })
        .from(players)
        .where(inArray(players.id, [...playerIds]));
      for (const r of rows) {
        nameMap.set(r.id, r.characterName ?? r.discordUsername);
      }
    }
    const getName = (id: string) => nameMap.get(id) ?? 'Unknown';

    const fields = [
      {
        name: 'Simulation Clock',
        value: clock
          ? [
              `**Date:** \`${clock.currentDate}\``,
              `**Tick:** \`${clock.currentTick}\` (${clock.tickUnit})`,
              `**Season:** ${clock.seasonName}`,
              `**Status:** ${clock.isPaused ? '**PAUSED**' : 'Running'}`,
            ].join('\n')
          : '_No clock configured._',
        inline: false,
      },
      {
        name: 'Open Tickets',
        value: `**${openTickets}**`,
        inline: true,
      },
      {
        name: 'Pending Bills',
        value: `**${pendingBills}**`,
        inline: true,
      },
      {
        name: 'Active Elections',
        value: `**${activeElections}**`,
        inline: true,
      },
      {
        name: 'Active Players',
        value: `**${activePlayers}**`,
        inline: true,
      },
      {
        name: 'Active Mod Actions',
        value: `**${activeModActions}**`,
        inline: true,
      },
    ];

    if (recentMod.length > 0) {
      fields.push({
        name: 'Recent Mod Activity',
        value: recentMod
          .map((m) => {
            const date = `<t:${Math.floor(m.createdAt.getTime() / 1000)}:R>`;
            return `${date} \`${formatType(m.type)}\` — ${getName(m.moderatorId)} → **${getName(m.targetPlayerId)}**`;
          })
          .join('\n'),
        inline: false,
      });
    } else {
      fields.push({
        name: 'Recent Mod Activity',
        value: '_No recent moderation activity._',
        inline: false,
      });
    }

    const embed = createEmbed({
      title: 'Dashboard',
      system: 'simulation',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
