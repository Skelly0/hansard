import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections, offices, players } from '@hansard/db';
import { DEFAULT_VOTE_DURATION_MS } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { hasPermission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /elect <office> [method] — Create a position election.
 *
 * Chancellor-only command. Creates an election with type 'position_election'
 * linked to the specified office. Candidates can then submit themselves.
 *
 * Example: /elect "Governor of Northshire" fptp
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('elect')
    .setDescription('Create a position election (Chancellor only)')
    .addStringOption((opt) =>
      opt
        .setName('office')
        .setDescription('The office to elect for (e.g. "Governor of Northshire")')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('method')
        .setDescription('Voting method (default: fptp)')
        .setRequired(false)
        .addChoices(
          { name: 'First Past the Post', value: 'fptp' },
          { name: 'Ranked Choice (IRV)', value: 'ranked_choice' },
          { name: 'Two-Round Runoff', value: 'two_round_runoff' },
          { name: 'Exhaustive Ballot', value: 'exhaustive_ballot' },
          { name: 'Approval Voting', value: 'approval' },
          { name: 'STV (Multi-Seat)', value: 'stv' },
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Permission check — requires legislative_leader or staff
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    const permitted = await hasPermission(member as any, 'voting.create');
    if (!permitted) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can create position elections.')],
        ephemeral: true,
      });
      return;
    }

    const officeName = interaction.options.getString('office', true).trim();
    const method = interaction.options.getString('method') ?? 'fptp';

    const allOffices = await db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(eq(offices.isActive, true));
    const office = allOffices.find((o) => o.name.toLowerCase() === officeName.toLowerCase())
      ?? allOffices.find((o) => o.name.toLowerCase().includes(officeName.toLowerCase()));

    if (!office) {
      await interaction.reply({
        embeds: [errorEmbed(`Office "${officeName}" not found.`)],
        ephemeral: true,
      });
      return;
    }

    const [creator] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!creator) {
      await interaction.reply({
        embeds: [errorEmbed('You are not registered as a player.')],
        ephemeral: true,
      });
      return;
    }

    const now = new Date();
    const nominationsCloseAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const votingClosesAt = new Date(nominationsCloseAt.getTime() + DEFAULT_VOTE_DURATION_MS);

    let electionId: string;
    try {
      const [row] = await db
        .insert(elections)
        .values({
          title: `Election: ${office.name}`,
          type: 'position_election',
          method,
          config: { runoffEnabled: method === 'two_round_runoff', runoffThreshold: 0.5 } as any,
          forOfficeId: office.id,
          nominationsOpenAt: now,
          nominationsCloseAt,
          votingOpensAt: nominationsCloseAt,
          votingClosesAt,
          status: 'nominations_open',
          createdById: creator.id,
        })
        .returning({ id: elections.id });
      electionId = row.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create election';
      await interaction.reply({ embeds: [errorEmbed(message)], ephemeral: true });
      return;
    }

    const embed = createEmbed({
      title: `Position Election: ${office.name}`,
      description: [
        `A position election has been created for **${office.name}**.`,
        '',
        `**Method:** ${method}`,
        `**Status:** Nominations Open`,
        '',
        'Candidates can submit themselves using `/candidate submit`.',
      ].join('\n'),
      system: 'voting',
      fields: [
        { name: 'Office', value: office.name, inline: true },
        { name: 'Method', value: method, inline: true },
        { name: 'Status', value: 'Nominations Open', inline: true },
        { name: 'Election ID', value: `\`${electionId}\``, inline: false },
      ],
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
