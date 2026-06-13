import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type NewsChannel,
  type ThreadChannel,
  type EmbedBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { bills, elections, players } from '@hansard/db';
import {
  DEFAULT_VOTE_DURATION_HOURS,
  REACTION_EMOJI,
  REACTION_COMPATIBLE_METHODS,
  SUPERMAJORITY_PASS_THRESHOLD,
} from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { hasPermission, type Permission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { wakeVoteAutoCloseWorker } from '../../services/voteAutoClose.js';
import { getRequestedVoteInterface } from './_electionReference.js';
import {
  buildSubmittedBillSelectOptions,
  createLegislativeBillVote,
  createStandaloneLegislativeVote,
  listSubmittedBillsForVote,
  STANDALONE_LEGISLATIVE_VOTE_OPTION_VALUE,
  type SubmittedBillSelectRow,
} from './billVoteFlow.js';
import {
  buildLinkedBillSourceDisplay,
  type BillSourceDisplay,
} from './billSourceDisplay.js';
import { dispatchSubcommand } from '../../utils/parentCommand.js';
import * as cast from './cast.js';
import * as close from './close.js';
import * as open from './open.js';
import * as list from './list.js';
import * as info from './info.js';
import * as results from './results.js';
import * as tally from './tally.js';
import * as certify from './certify.js';
import * as cancel from './cancel.js';
import * as history from './history.js';
import * as schedule from './schedule.js';
import * as eligibility from './eligibility.js';
import * as rounds from './rounds.js';
import * as runoff from './runoff.js';
import * as turnout from './turnout.js';
import * as elect from './elect.js';
import * as candidateSubmit from './candidateSubmit.js';
import * as candidateList from './candidateList.js';
import * as npcConfirm from './npcConfirm.js';

const CHANCELLOR_ONLY_TYPES = new Set([
  'legislative_vote',
  'position_election',
  'appointment_confirmation',
]);

const REQUIRED_PERMISSION_BY_TYPE: Record<string, Permission> = {
  legislative_vote: 'legislative_leader',
  position_election: 'call_elections',
  appointment_confirmation: 'call_elections',
};

const METHOD_LABELS: Record<string, string> = {
  yea_nay_abstain: 'Yea / Nay / Abstain',
  fptp: 'First Past the Post',
  ranked_choice: 'Ranked Choice (IRV)',
  approval: 'Approval Voting',
  two_round_runoff: 'Two-Round Runoff',
  exhaustive_ballot: 'Exhaustive Ballot',
  stv: 'Single Transferable Vote',
  proportional: 'Proportional Representation',
};

const TYPE_LABELS: Record<string, string> = {
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

function formatBillDisplay(bill: Pick<SubmittedBillSelectRow, 'title' | 'billNumber'>): string {
  return `B-${String(bill.billNumber).padStart(3, '0')} - ${bill.title}`;
}

export function buildReactionVoteInstructions(method: string): string {
  if (method === 'yea_nay_abstain') {
    return `React with ${REACTION_EMOJI.YEA} for **Yea**, ${REACTION_EMOJI.NAY} for **Nay**, or ${REACTION_EMOJI.ABSTAIN} for **Abstain**.\nReactions stay visible as the public voting record. If you change your vote, remove your old reaction and add the new one.`;
  }

  return 'React with the number matching your preferred candidate. Use `/vote candidate-list` to see candidates by position.\nReactions stay visible as the public voting record. If you change your vote, remove your old reaction and add the new one.\n*Note: candidates must be registered before votes are cast -- restart the vote if you add candidates after.*';
}

function buildVoteCreateModal(
  customId: string,
  defaults: { title?: string; description?: string | null; durationHours?: number } = {},
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Create Vote');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Title')
    .setPlaceholder('e.g. "Vote on the Land Reform Act"')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256);

  if (defaults.title) {
    titleInput.setValue(defaults.title.slice(0, 256));
  }

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setPlaceholder('Briefly describe what is being voted on...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000);

  if (defaults.description) {
    descriptionInput.setValue(defaults.description.slice(0, 2000));
  }

  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('Duration (hours)')
    .setPlaceholder(String(DEFAULT_VOTE_DURATION_HOURS))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);

  if (defaults.durationHours) {
    durationInput.setValue(String(defaults.durationHours));
  }

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
  );

  return modal;
}

export function buildLegislativeVotePublicEmbeds(options: {
  title: string;
  description: string | null;
  useReactions: boolean;
  reactionInstructions: string;
  baseFields: { name: string; value: string; inline?: boolean }[];
  billSource: BillSourceDisplay;
}): EmbedBuilder[] {
  const publicEmbed = createEmbed({
    title: options.title,
    description: [
      options.description ? `> ${options.description}\n` : '',
      options.useReactions ? '**This is a public reaction vote.**' : '**A legislative vote has been opened.**',
      options.useReactions
        ? options.reactionInstructions
        : 'Players can cast ballots with `/vote cast` or the usual vote controls.',
    ]
      .filter(Boolean)
      .join('\n'),
    system: 'voting',
    fields: [...options.baseFields, ...options.billSource.fields],
  });

  return [publicEmbed, ...options.billSource.embeds];
}

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
    )
    .addSubcommand((sub) =>
      sub
        .setName('cast')
        .setDescription('Cast a ballot in an election')
        .addStringOption((opt) =>
          opt
            .setName('election_id')
            .setDescription('The election ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close voting on an election (Chancellor/staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('open')
        .setDescription('Open an election for voting (Chancellor/staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Browse votes and elections — past or present')
        .addStringOption((opt) =>
          opt
            .setName('scope')
            .setDescription('Active, past, or all (default: all)')
            .setRequired(false)
            .addChoices(
              { name: 'Active (anything in motion)', value: 'active' },
              { name: 'Past (certified or cancelled)', value: 'past' },
              { name: 'All', value: 'all' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Filter by exact status (overrides scope)')
            .setRequired(false)
            .addChoices(
              { name: 'Draft', value: 'draft' },
              { name: 'Nominations Open', value: 'nominations_open' },
              { name: 'Nominations Closed', value: 'nominations_closed' },
              { name: 'Voting Open', value: 'voting_open' },
              { name: 'Voting Closed', value: 'voting_closed' },
              { name: 'Tallied', value: 'tallied' },
              { name: 'Runoff Needed', value: 'runoff_needed' },
              { name: 'NPC Pending', value: 'npc_pending' },
              { name: 'Certified', value: 'certified' },
              { name: 'Cancelled', value: 'cancelled' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Filter by election type')
            .setRequired(false)
            .addChoices(
              { name: 'Legislative Vote', value: 'legislative_vote' },
              { name: 'Position Election', value: 'position_election' },
              { name: 'Appointment Confirmation', value: 'appointment_confirmation' },
              { name: 'General Election', value: 'general_election' },
              { name: 'Referendum', value: 'referendum' },
              { name: 'Confidence Vote', value: 'confidence_vote' },
              { name: 'Constitutional Amendment', value: 'constitutional_amendment' },
              { name: 'Party Primary', value: 'party_primary' },
              { name: 'Custom', value: 'custom' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('range')
            .setDescription('Limit to votes created within a time window')
            .setRequired(false)
            .addChoices(
              { name: 'Last 7 days', value: '7' },
              { name: 'Last 30 days', value: '30' },
              { name: 'Last 90 days', value: '90' },
              { name: 'All time', value: 'all' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Show details for an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('results')
        .setDescription('Show the results of an election')
        .addStringOption((opt) =>
          opt
            .setName('election_id')
            .setDescription('The election ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('tally')
        .setDescription('Force-tally an election (staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('certify')
        .setDescription('Certify a tallied election result (staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel a vote or election (Chancellor/staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason to record in linked bill history')
            .setRequired(false)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Browse completed votes (certified or cancelled)')
        .addStringOption((opt) =>
          opt
            .setName('range')
            .setDescription('Time window (default: last 30 days)')
            .setRequired(false)
            .addChoices(
              { name: 'Last 7 days', value: '7' },
              { name: 'Last 30 days', value: '30' },
              { name: 'Last 90 days', value: '90' },
              { name: 'Last year', value: '365' },
              { name: 'All time', value: 'all' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Filter by election type')
            .setRequired(false)
            .addChoices(
              { name: 'Legislative Vote', value: 'legislative_vote' },
              { name: 'Position Election', value: 'position_election' },
              { name: 'Appointment Confirmation', value: 'appointment_confirmation' },
              { name: 'General Election', value: 'general_election' },
              { name: 'Referendum', value: 'referendum' },
              { name: 'Confidence Vote', value: 'confidence_vote' },
              { name: 'Constitutional Amendment', value: 'constitutional_amendment' },
              { name: 'Party Primary', value: 'party_primary' },
              { name: 'Custom', value: 'custom' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('schedule')
        .setDescription('Schedule a future vote/election (Chancellor/staff)')
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Title of the vote')
            .setRequired(true)
            .setMaxLength(256),
        )
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
        .addNumberOption((opt) =>
          opt
            .setName('opens-in-hours')
            .setDescription('Hours from now until voting opens (e.g. 24 = tomorrow)')
            .setRequired(true)
            .setMinValue(0.25)
            .setMaxValue(24 * 365),
        )
        .addNumberOption((opt) =>
          opt
            .setName('duration-hours')
            .setDescription(`How long voting stays open after it opens (default ${DEFAULT_VOTE_DURATION_HOURS})`)
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(24 * 365),
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('What is being voted on')
            .setRequired(false)
            .setMaxLength(2000),
        )
        .addStringOption((opt) =>
          opt
            .setName('majority')
            .setDescription('Majority type (yea/nay only)')
            .setRequired(false)
            .addChoices(
              { name: 'Simple Majority', value: 'simple' },
              { name: 'Absolute Majority', value: 'absolute' },
              { name: 'Supermajority (2/3)', value: 'supermajority' },
              { name: 'Unanimous', value: 'unanimous' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('eligibility')
        .setDescription('Check if you can vote in an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rounds')
        .setDescription('Show round-by-round results for an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('runoff')
        .setDescription('Spawn a runoff round for an election (Chancellor/staff)')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('turnout')
        .setDescription('Show live turnout stats for an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
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
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('candidate-submit')
        .setDescription('Register yourself as a candidate in an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('statement')
            .setDescription('Optional candidate statement / manifesto')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('candidate-list')
        .setDescription('List candidates registered in an election')
        .addStringOption((opt) =>
          opt
            .setName('election')
            .setDescription('Election title or ID')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('npc-confirm')
        .setDescription('Enter NPC house confirmation for an election (staff only)')
        .addStringOption((opt) =>
          opt
            .setName('election_id')
            .setDescription('The election ID')
            .setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('yea')
            .setDescription('Number of NPC yea votes')
            .setRequired(true)
            .setMinValue(0),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('nay')
            .setDescription('Number of NPC nay votes')
            .setRequired(true)
            .setMinValue(0),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('abstain')
            .setDescription('Number of NPC abstain votes')
            .setRequired(true)
            .setMinValue(0),
        )
        .addStringOption((opt) =>
          opt
            .setName('notes')
            .setDescription('Optional notes about the NPC decision')
            .setRequired(false),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, {
      create: { execute: handleCreateSubcommand },
      cast,
      close,
      open,
      list,
      info,
      results,
      tally,
      certify,
      cancel,
      history,
      schedule,
      eligibility,
      rounds,
      runoff,
      turnout,
      elect,
      'candidate-submit': candidateSubmit,
      'candidate-list': candidateList,
      'npc-confirm': npcConfirm,
    });
  },
};

async function handleCreateSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
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

  if (electionType === 'legislative_vote') {
    await handleLegislativeBillVoteCreate(interaction, { method, majority, iface });
    return;
  }

  // Show modal for title and description. Carry the iface choice through customId.
  await interaction.showModal(
    buildVoteCreateModal(`vote-create:${electionType}:${method}:${majority}:${iface}`),
  );
}

async function handleLegislativeBillVoteCreate(
  interaction: ChatInputCommandInteraction,
  options: { method: string; majority: string; iface: string },
): Promise<void> {
  const member = interaction.member;
  const allowed = member && 'roles' in member
    ? await hasPermission(member as any, 'legislative_leader')
    : false;

  if (!allowed) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff or an office holder with legislative leader permission can open legislative votes.')],
      ephemeral: true,
    });
    return;
  }

  const submittedBills = await listSubmittedBillsForVote(db);

  const selectCustomId = `vote_create_bill_select:${interaction.user.id}:${interaction.id}`;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder('Select a bill or standalone vote...')
    .addOptions(buildSubmittedBillSelectOptions(submittedBills, { includeStandalone: true }));

  const reply = await interaction.reply({
    embeds: [
      createEmbed({
        title: 'Select Legislative Vote Subject',
        description: [
          `**Method:** ${METHOD_LABELS[options.method] ?? options.method}`,
          options.method === 'yea_nay_abstain'
            ? `**Majority:** ${options.majority.charAt(0).toUpperCase()}${options.majority.slice(1)}`
            : null,
          `**Interface:** ${options.iface === 'reactions' ? 'Reactions' : 'Buttons'}`,
          '',
          submittedBills.length > 0
            ? 'Choose a submitted bill, or choose a standalone vote for an agenda item without a bill.'
            : 'No submitted bills are waiting. Choose the standalone option to open a legislative vote on another agenda item.',
        ]
          .filter(Boolean)
          .join('\n'),
        system: 'bills',
      }),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    ],
    ephemeral: true,
    fetchReply: true,
  });

  let billInteraction: StringSelectMenuInteraction;
  try {
    billInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id && i.customId === selectCustomId,
      time: 60_000,
    }) as StringSelectMenuInteraction;
  } catch {
    await interaction.editReply({
      embeds: [errorEmbed('Legislative vote subject selection timed out. Run `/vote create` again when you are ready.')],
      components: [],
    });
    return;
  }

  const selectedValue = billInteraction.values[0];
  const isStandaloneVote = selectedValue === STANDALONE_LEGISLATIVE_VOTE_OPTION_VALUE;
  const selectedBill = isStandaloneVote
    ? null
    : submittedBills.find((bill) => bill.id === selectedValue) ?? null;

  if (!isStandaloneVote && !selectedBill) {
    await billInteraction.update({
      embeds: [errorEmbed('That legislative vote subject is no longer available. Please run `/vote create` again.')],
      components: [],
    });
    return;
  }

  const defaultDescription = selectedBill
    ? selectedBill.summary ?? `Legislative vote on ${formatBillDisplay(selectedBill)}.`
    : null;
  const modalCustomId = `vote_create_bill_modal:${interaction.id}:${isStandaloneVote ? 'standalone' : selectedBill?.id}`;

  await billInteraction.showModal(
    buildVoteCreateModal(modalCustomId, {
      title: selectedBill ? `Vote on B-${String(selectedBill.billNumber).padStart(3, '0')}: ${selectedBill.title}` : undefined,
      description: defaultDescription,
      durationHours: DEFAULT_VOTE_DURATION_HOURS,
    }),
  );

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await billInteraction.awaitModalSubmit({
      filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
      time: 300_000,
    });
  } catch {
    await interaction.editReply({
      embeds: [errorEmbed('Vote details timed out. Run `/vote create` again when you are ready.')],
      components: [],
    });
    return;
  }

  await modalSubmit.deferReply({ ephemeral: true });

  const title = modalSubmit.fields.getTextInputValue('title').trim();
  const description = modalSubmit.fields.getTextInputValue('description').trim() || null;
  const durationStr = modalSubmit.fields.getTextInputValue('duration') || String(DEFAULT_VOTE_DURATION_HOURS);
  const durationHours = Math.max(1, parseInt(durationStr, 10) || DEFAULT_VOTE_DURATION_HOURS);
  const useReactions = options.iface === 'reactions';
  const channel = interaction.channel;

  if (!title) {
    await modalSubmit.editReply({
      embeds: [errorEmbed('Vote title cannot be blank.')],
    });
    return;
  }

  if (useReactions && (!channel || !('send' in channel))) {
    await modalSubmit.editReply({
      embeds: [errorEmbed('Reaction-mode voting must be created in a text channel.')],
    });
    return;
  }

  let result: Awaited<ReturnType<typeof createLegislativeBillVote>>
    | Awaited<ReturnType<typeof createStandaloneLegislativeVote>>;
  try {
    result = selectedBill
      ? await createLegislativeBillVote(db, {
          billId: selectedBill.id,
          creatorDiscordId: interaction.user.id,
          title,
          description,
          method: options.method,
          majority: options.majority,
          durationHours,
          useReactions,
        })
      : await createStandaloneLegislativeVote(db, {
          creatorDiscordId: interaction.user.id,
          title,
          description,
          method: options.method,
          majority: options.majority,
          durationHours,
          useReactions,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create the legislative vote.';
    await modalSubmit.editReply({ embeds: [errorEmbed(message)] });
    return;
  }

  const fields = [
    selectedBill
      ? { name: 'Bill', value: formatBillDisplay(selectedBill), inline: false }
      : { name: 'Subject', value: 'Standalone legislative agenda item', inline: false },
    { name: 'Type', value: TYPE_LABELS.legislative_vote, inline: true },
    { name: 'Method', value: METHOD_LABELS[options.method] ?? options.method, inline: true },
    { name: 'Closes', value: `<t:${Math.floor(result.votingClosesAt.getTime() / 1000)}:R>`, inline: true },
    ...(options.method === 'yea_nay_abstain'
      ? [{
          name: 'Majority',
          value: options.majority.charAt(0).toUpperCase() + options.majority.slice(1),
          inline: true,
        }]
      : []),
    { name: 'Election ID', value: `\`${result.electionId}\``, inline: false },
  ];

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: selectedBill ? 'Bill Vote Created' : 'Legislative Vote Created',
        description: selectedBill
          ? `Selected **${formatBillDisplay(selectedBill)}**.`
          : 'No submitted bill was linked to this vote.',
        system: selectedBill ? 'bills' : 'voting',
      }),
    ],
    components: [],
  }).catch(() => undefined);

  if (channel && 'send' in channel) {
    const reactionInstructions = buildReactionVoteInstructions(options.method);

    const billSource = selectedBill
      ? await buildLinkedBillSourceDisplay(db, {
          type: 'legislative_vote',
          relatedBillId: selectedBill.id,
        })
      : { fields: [], embeds: [] };
    const publicEmbeds = buildLegislativeVotePublicEmbeds({
      title,
      description,
      useReactions,
      reactionInstructions,
      baseFields: fields,
      billSource,
    });

    try {
      const posted = await (channel as TextChannel | NewsChannel | ThreadChannel).send({
        embeds: publicEmbeds,
      });

      if (useReactions) {
        await db
          .update(elections)
          .set({
            discordMessageId: posted.id,
            discordChannelId: posted.channelId,
            updatedAt: new Date(),
          })
          .where(eq(elections.id, result.electionId));

        if (options.method === 'yea_nay_abstain') {
          try {
            await posted.react(REACTION_EMOJI.YEA);
            await posted.react(REACTION_EMOJI.NAY);
            await posted.react(REACTION_EMOJI.ABSTAIN);
          } catch (error) {
            console.error(`[vote-create] failed to seed reactions on ${posted.id}:`, error);
          }
        }
      }
    } catch (error) {
      if (useReactions) {
        await db
          .update(elections)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(elections.id, result.electionId));
        if (selectedBill) {
          await db
            .update(bills)
            .set({ status: 'submitted', playerVoteId: null, updatedAt: new Date() })
            .where(eq(bills.id, selectedBill.id));
        }

        const message = error instanceof Error ? error.message : 'Failed to post vote message';
        await modalSubmit.editReply({ embeds: [errorEmbed(message)] });
        return;
      }

      console.error(`[vote-create] failed to announce legislative vote ${result.electionId}:`, error);
    }
  }

  wakeVoteAutoCloseWorker('vote-created');

  await modalSubmit.editReply({
    embeds: [
      createEmbed({
        title: useReactions ? 'Reaction Vote Posted' : 'Legislature Vote Opened',
        description: [
          selectedBill
            ? `**${formatBillDisplay(selectedBill)}** is now in voting.`
            : `**${title}** is now open for legislative voting.`,
          useReactions
            ? 'The public reaction vote has been posted in this channel.'
            : 'The election is recorded and available through the vote commands.',
          '',
          `Election ID: \`${result.electionId}\``,
        ].join('\n'),
        system: 'voting',
      }),
    ],
  });
}

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

  await interaction.deferReply({ ephemeral: true });

  // Re-check permission for restricted types — modal submits don't re-run
  // the slash command's permission logic.
  if (CHANCELLOR_ONLY_TYPES.has(electionType)) {
    const member = interaction.member;
    const requiredPermission = REQUIRED_PERMISSION_BY_TYPE[electionType] ?? 'legislative_leader';
    const allowed = member && 'roles' in member
      ? await hasPermission(member as any, requiredPermission)
      : false;
    if (!allowed) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff or an office holder with the required voting permission can create this type of vote.')],
      });
      return;
    }
  }

  // Defensive: reject reaction mode for ranked methods on the modal side too,
  // even though the slash command should have caught it (someone could craft
  // a modal directly).
  if (iface === 'reactions' && !REACTION_COMPATIBLE_METHODS.includes(method as never)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Reaction-mode voting is not supported for method \`${method}\`. Use buttons.`,
        ),
      ],
    });
    return;
  }

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description') || null;
  const durationStr = interaction.fields.getTextInputValue('duration') || String(DEFAULT_VOTE_DURATION_HOURS);
  const durationHours = Math.max(1, parseInt(durationStr, 10) || DEFAULT_VOTE_DURATION_HOURS);

  const now = new Date();
  const votingClosesAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  // Build the config
  const config: Record<string, unknown> = {};
  if (method === 'yea_nay_abstain') {
    config.majorityType = majority;
    if (majority === 'supermajority') {
      config.passThreshold = SUPERMAJORITY_PASS_THRESHOLD;
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
    await interaction.editReply({
      embeds: [errorEmbed('You are not registered as a player. Run `/character create` first.')],
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
    wakeVoteAutoCloseWorker('vote-created');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create election';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
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

  // ---- Buttons mode: post the vote publicly, then confirm to the creator ----
  if (!useReactions) {
    const embed = createEmbed({
      title,
      description: description ? `> ${description}` : undefined,
      system: 'voting',
      fields: baseFields,
    });

    const channel = interaction.channel;
    if (channel && 'send' in channel) {
      try {
        await (channel as TextChannel | NewsChannel | ThreadChannel).send({ embeds: [embed] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to post vote message';
        await interaction.editReply({ embeds: [errorEmbed(message)] });
        return;
      }

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Vote Created',
            description: `The vote has been posted in this channel.\n\nElection ID: \`${electionId}\``,
            system: 'voting',
          }),
        ],
      });
      return;
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ---- Reactions mode: post a public embed in the channel and seed reactions ----
  const channel = interaction.channel;
  if (!channel || !('send' in channel)) {
    await interaction.editReply({
      embeds: [errorEmbed('Reaction-mode voting must be created in a text channel.')],
    });
    return;
  }

  const reactionInstructions = buildReactionVoteInstructions(method);

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
    await interaction.editReply({ embeds: [errorEmbed(message)] });
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
  // /vote candidate-submit completion or a follow-up command.
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
  // FPTP: candidate emoji are seeded by the vote candidate-list flow once
  // candidates are registered (see candidateSubmit.ts — TODO follow-up).

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: 'Reaction Vote Posted',
        description: `The vote has been posted in this channel. Players cast their ballot by reacting.\n\nElection ID: \`${electionId}\``,
        system: 'voting',
      }),
    ],
  });
}

export default command;
