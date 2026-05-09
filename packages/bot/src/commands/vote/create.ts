import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
  type NewsChannel,
  type ThreadChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections, players } from '@hansard/db';
import { REACTION_EMOJI, REACTION_COMPATIBLE_METHODS } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { getRequestedVoteInterface } from './_electionReference.js';

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
 * 3. On submit, bot creates the election in the DB
 * 4. If reactions are selected (the default for compatible methods):
 *    - The bot posts the vote embed in the current channel and seeds it
 *      with the reaction emoji for the chosen method.
 *    - Players cast votes by clicking reactions; the MessageReactionAdd
 *      listener (events/messageReactionAdd.ts) records ballots.
 *    - Reactions mode is only allowed for `yea_nay_abstain` and `fptp`.
 *      Ranked methods (ranked_choice / stv / approval / two_round_runoff /
 *      exhaustive_ballot / proportional) reject with an error.
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
        )
        .addStringOption((opt) =>
          opt
            .setName('interface')
            .setDescription('How players cast votes (defaults to reactions when supported)')
            .setRequired(false)
            .addChoices(
              { name: 'Reactions (public, on the embed)', value: 'reactions' },
              { name: 'Buttons (private/ephemeral)', value: 'buttons' },
            ),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'create') return;

    const electionType = interaction.options.getString('type', true);
    const method = interaction.options.getString('method', true);
    const majority = interaction.options.getString('majority') ?? 'simple';
    const iface = getRequestedVoteInterface(interaction.options.getString('interface'), method);

    // Reject reaction mode early for incompatible methods.
    // (Only `yea_nay_abstain` and `fptp` map cleanly to a small set of emoji.)
    if (iface === 'reactions' && !REACTION_COMPATIBLE_METHODS.includes(method as never)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `Reaction-mode voting is only supported for **Yea/Nay/Abstain** and **First Past the Post**. Method \`${method}\` requires the buttons interface.`,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    // Show modal for title and description. Carry the iface choice through customId.
    const modal = new ModalBuilder()
      .setCustomId(`vote-create:${electionType}:${method}:${majority}:${iface}`)
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
 *
 * customId shape: vote-create:<type>:<method>:<majority>:<iface>
 * `iface` is appended in the slash handler — older customIds without it
 * use the current default for the chosen method.
 */
export async function handleVoteCreateModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parts = interaction.customId.split(':');
  const [, electionType, method, majority, ifaceRaw] = parts;
  const iface = getRequestedVoteInterface(ifaceRaw ?? null, method);

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

  // Defensive: reject reaction mode for ranked methods on the modal side too,
  // even though the slash command should have caught it (someone could craft
  // a modal directly).
  if (iface === 'reactions' && !REACTION_COMPATIBLE_METHODS.includes(method as never)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Reaction-mode voting is not supported for method \`${method}\`. Use buttons.`,
        ),
      ],
      ephemeral: true,
    });
    return;
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

  const useReactions = iface === 'reactions';

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
        useReactions,
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

  const baseFields = [
    { name: 'Type', value: typeLabels[electionType] ?? electionType, inline: true },
    { name: 'Method', value: methodLabels[method] ?? method, inline: true },
    { name: 'Closes', value: `<t:${Math.floor(votingClosesAt.getTime() / 1000)}:R>`, inline: true },
    ...(method === 'yea_nay_abstain'
      ? [{ name: 'Majority', value: majority.charAt(0).toUpperCase() + majority.slice(1), inline: true }]
      : []),
    { name: 'Election ID', value: `\`${electionId}\``, inline: false },
  ];

  // ---- Buttons mode: just confirm to the creator (existing behaviour) ----
  if (!useReactions) {
    const embed = createEmbed({
      title,
      description: description ? `> ${description}` : undefined,
      system: 'voting',
      fields: baseFields,
    });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ---- Reactions mode: post a public embed in the channel and seed reactions ----
  const channel = interaction.channel;
  if (!channel || !('send' in channel)) {
    await interaction.reply({
      embeds: [errorEmbed('Reaction-mode voting must be created in a text channel.')],
      ephemeral: true,
    });
    return;
  }

  const reactionInstructions =
    method === 'yea_nay_abstain'
      ? `React with ${REACTION_EMOJI.YEA} for **Yea**, ${REACTION_EMOJI.NAY} for **Nay**, or ${REACTION_EMOJI.ABSTAIN} for **Abstain**.\nYour reaction is removed once recorded; you may change your vote by reacting again.`
      : `React with the number matching your preferred candidate. Use \`/candidate-list\` to see candidates by position.\n*Note: candidates must be registered before votes are cast — restart the vote if you add candidates after.*`;

  const reactionEmbed = createEmbed({
    title,
    description: [
      description ? `> ${description}\n` : '',
      '**This is a public reaction vote.**',
      reactionInstructions,
    ]
      .filter(Boolean)
      .join('\n'),
    system: 'voting',
    fields: baseFields,
  });

  let posted: Awaited<ReturnType<TextChannel['send']>>;
  try {
    posted = await (channel as TextChannel | NewsChannel | ThreadChannel).send({ embeds: [reactionEmbed] });
  } catch (error) {
    // Roll back: mark election cancelled so it doesn't sit orphaned.
    await db
      .update(elections)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(elections.id, electionId));
    const message = error instanceof Error ? error.message : 'Failed to post vote message';
    await interaction.reply({ embeds: [errorEmbed(message)], ephemeral: true });
    return;
  }

  // Persist the message + channel IDs so MessageReactionAdd can match.
  await db
    .update(elections)
    .set({
      discordMessageId: posted.id,
      discordChannelId: posted.channelId,
      updatedAt: new Date(),
    })
    .where(eq(elections.id, electionId));

  // Seed reactions. For yea_nay_abstain we add all three immediately; for FPTP
  // candidates are registered separately and reactions are seeded later via
  // /candidate-submit completion or a follow-up command.
  if (method === 'yea_nay_abstain') {
    try {
      await posted.react(REACTION_EMOJI.YEA);
      await posted.react(REACTION_EMOJI.NAY);
      await posted.react(REACTION_EMOJI.ABSTAIN);
    } catch (error) {
      console.error(`[vote-create] failed to seed reactions on ${posted.id}:`, error);
      // Non-fatal — the election is recorded; staff can re-seed manually.
    }
  }
  // FPTP: candidate emoji are seeded by the candidate-list flow once
  // candidates are registered (see candidateSubmit.ts — TODO follow-up).

  await interaction.reply({
    embeds: [
      createEmbed({
        title: 'Reaction Vote Posted',
        description: `The vote has been posted in this channel. Players cast their ballot by reacting.\n\nElection ID: \`${electionId}\``,
        system: 'voting',
      }),
    ],
    ephemeral: true,
  });
}

export default command;
