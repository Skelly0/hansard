import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  ComponentType,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections, players } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const CHANCELLOR_ONLY_TYPES = new Set([
  'legislative_vote',
  'position_election',
  'appointment_confirmation',
]);

/**
 * /vote create — opens a modal to create a new election or vote.
 *
 * Flow:
 * 1. User runs /vote create
 * 2. Bot shows a modal with: title, description, type, method, majority type
 * 3. On submit, bot creates the election via the API
 *
 * Permission:
 * - Any player can create: referendum, party_primary, confidence_vote, custom
 * - Chancellor only: legislative_vote, position_election, appointment_confirmation
 * - Staff: any type
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Voting and election commands')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new vote or election')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Type of vote')
            .setRequired(true)
            .addChoices(
              { name: 'Referendum', value: 'referendum' },
              { name: 'Confidence Vote', value: 'confidence_vote' },
              { name: 'Party Primary', value: 'party_primary' },
              { name: 'Custom Vote', value: 'custom' },
              { name: 'Legislative Vote (Chancellor)', value: 'legislative_vote' },
              { name: 'Position Election (Chancellor)', value: 'position_election' },
              { name: 'Appointment Confirmation (Chancellor)', value: 'appointment_confirmation' },
              { name: 'General Election', value: 'general_election' },
              { name: 'Constitutional Amendment', value: 'constitutional_amendment' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('method')
            .setDescription('Voting method')
            .setRequired(true)
            .addChoices(
              { name: 'Yea / Nay / Abstain', value: 'yea_nay_abstain' },
              { name: 'First Past the Post', value: 'fptp' },
              { name: 'Ranked Choice (Instant Runoff)', value: 'ranked_choice' },
              { name: 'Approval Voting', value: 'approval' },
              { name: 'Two-Round Runoff', value: 'two_round_runoff' },
              { name: 'Exhaustive Ballot', value: 'exhaustive_ballot' },
              { name: 'Single Transferable Vote', value: 'stv' },
              { name: 'Proportional Representation', value: 'proportional' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('majority')
            .setDescription('Majority type (for yea/nay votes)')
            .setRequired(false)
            .addChoices(
              { name: 'Simple Majority', value: 'simple' },
              { name: 'Absolute Majority', value: 'absolute' },
              { name: 'Supermajority (2/3)', value: 'supermajority' },
              { name: 'Unanimous', value: 'unanimous' },
            ),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'create') return;

    const electionType = interaction.options.getString('type', true);
    const method = interaction.options.getString('method', true);
    const majority = interaction.options.getString('majority') ?? 'simple';

    // Show modal for title and description
    const modal = new ModalBuilder()
      .setCustomId(`vote-create:${electionType}:${method}:${majority}`)
      .setTitle('Create Vote');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title')
      .setPlaceholder('e.g. "Vote on the Land Reform Act"')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setPlaceholder('Briefly describe what is being voted on...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration (hours)')
      .setPlaceholder('48')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(5);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
    );

    await interaction.showModal(modal);
  },
};

/**
 * Handle the vote-create modal submission.
 * Called from the interaction router.
 */
export async function handleVoteCreateModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const [, electionType, method, majority] = interaction.customId.split(':');

  // Re-check permission for restricted types — modal submits don't re-run
  // the slash command's permission logic.
  if (CHANCELLOR_ONLY_TYPES.has(electionType)) {
    const member = interaction.member;
    const allowed = member && 'roles' in member ? await isStaff(member as any) : false;
    if (!allowed) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can create this type of vote.')],
        ephemeral: true,
      });
      return;
    }
  }

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description') || null;
  const durationStr = interaction.fields.getTextInputValue('duration') || '48';
  const durationHours = Math.max(1, parseInt(durationStr, 10) || 48);

  const now = new Date();
  const votingClosesAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  // Build the config
  const config: Record<string, unknown> = {};
  if (method === 'yea_nay_abstain') {
    config.majorityType = majority;
    if (majority === 'supermajority') {
      config.passThreshold = 0.667;
    }
  }
  if (['two_round_runoff', 'fptp'].includes(method)) {
    config.runoffEnabled = method === 'two_round_runoff';
    config.runoffThreshold = 0.5;
  }

  const [creator] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (!creator) {
    await interaction.reply({
      embeds: [errorEmbed('You are not registered as a player. Run `/character create` first.')],
      ephemeral: true,
    });
    return;
  }

  let electionId: string;
  try {
    const [row] = await db
      .insert(elections)
      .values({
        title,
        description,
        type: electionType,
        method,
        config: config as any,
        votingOpensAt: now,
        votingClosesAt,
        status: 'voting_open',
        createdById: creator.id,
      })
      .returning({ id: elections.id });
    electionId = row.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create election';
    await interaction.reply({ embeds: [errorEmbed(message)], ephemeral: true });
    return;
  }

  const methodLabels: Record<string, string> = {
    yea_nay_abstain: 'Yea / Nay / Abstain',
    fptp: 'First Past the Post',
    ranked_choice: 'Ranked Choice (IRV)',
    approval: 'Approval Voting',
    two_round_runoff: 'Two-Round Runoff',
    exhaustive_ballot: 'Exhaustive Ballot',
    stv: 'Single Transferable Vote',
    proportional: 'Proportional Representation',
  };

  const typeLabels: Record<string, string> = {
    referendum: 'Referendum',
    confidence_vote: 'Vote of Confidence',
    party_primary: 'Party Primary',
    custom: 'Custom Vote',
    legislative_vote: 'Legislative Vote',
    position_election: 'Position Election',
    appointment_confirmation: 'Appointment Confirmation',
    general_election: 'General Election',
    constitutional_amendment: 'Constitutional Amendment',
  };

  const embed = createEmbed({
    title: title,
    description: description ? `> ${description}` : undefined,
    system: 'voting',
    fields: [
      { name: 'Type', value: typeLabels[electionType] ?? electionType, inline: true },
      { name: 'Method', value: methodLabels[method] ?? method, inline: true },
      { name: 'Closes', value: `<t:${Math.floor(votingClosesAt.getTime() / 1000)}:R>`, inline: true },
      ...(method === 'yea_nay_abstain'
        ? [{ name: 'Majority', value: majority.charAt(0).toUpperCase() + majority.slice(1), inline: true }]
        : []),
      { name: 'Election ID', value: `\`${electionId}\``, inline: false },
    ],
  });

  await interaction.reply({ embeds: [embed] });
}

export default command;
