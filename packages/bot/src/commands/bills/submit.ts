import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
  registerAwaitingInteraction,
  unregisterAwaitingInteraction,
} from '../../utils/awaitingInteractions.js';
import type { Command } from '../../client.js';
import { dispatchSubcommand } from '../../utils/parentCommand.js';
import { SHORT_BILL_TEXT_MAX_LENGTH } from './display.js';
import { extractDocId, isValidGoogleDocUrl } from './shared.js';
import { STATUS_CHOICES } from './list.js';
import * as view from './view.js';
import * as list from './list.js';
import * as search from './search.js';
import * as edit from './edit.js';
import * as status from './status.js';
import * as enact from './enact.js';
import * as repeal from './repeal.js';
import * as amend from './amend.js';
import * as amendEffects from './amendEffects.js';
import * as voters from './voters.js';
import * as reraise from './reraise.js';
import * as withdraw from './withdraw.js';
import * as recache from './recache.js';
import * as submitFor from './submitFor.js';
import * as npcVote from './npcVote.js';

type BillSubmissionType = 'google_doc' | 'short';

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

async function findSubmittingPlayer(discordId: string) {
  const [player] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);

  return player ?? null;
}

async function uniqueBillSlug(title: string): Promise<string> {
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'bill';

  let finalSlug = baseSlug;
  let counter = 1;

  while (true) {
    const [existing] = await db
      .select({ id: bills.id })
      .from(bills)
      .where(eq(bills.slug, finalSlug))
      .limit(1);

    if (!existing) return finalSlug;

    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }
}

function parseModalMetadata(modalSubmit: ModalSubmitInteraction) {
  const summary = modalSubmit.fields.getTextInputValue('summary').trim() || null;
  const tags = splitCsv(modalSubmit.fields.getTextInputValue('tags').trim());
  const policyAreas = splitCsv(modalSubmit.fields.getTextInputValue('policy_areas').trim());

  return { summary, tags, policyAreas };
}

async function executeSubmit(interaction: ChatInputCommandInteraction): Promise<void> {
  const title = interaction.options.getString('title', true);

  const typeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bill_submit_type:${interaction.user.id}:google_doc`)
      .setLabel('Google Doc')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bill_submit_type:${interaction.user.id}:short`)
      .setLabel('Short Bill')
      .setStyle(ButtonStyle.Secondary),
  );

  const chooser = await interaction.reply({
    embeds: [successEmbed(
      'Choose Bill Type',
      [
        `**${title}**`,
        '',
        'Pick whether this bill links to a Google Doc or is a short text-only bill.',
      ].join('\n'),
    )],
    components: [typeRow],
    ephemeral: true,
    fetchReply: true,
  });

  const googleDocButtonId = `bill_submit_type:${interaction.user.id}:google_doc`;
  const shortButtonId = `bill_submit_type:${interaction.user.id}:short`;

  let typeInteraction: ButtonInteraction;
  registerAwaitingInteraction(googleDocButtonId);
  registerAwaitingInteraction(shortButtonId);
  try {
    typeInteraction = await chooser.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.user.id === interaction.user.id
        && i.customId.startsWith(`bill_submit_type:${interaction.user.id}:`),
      time: 60_000,
    }) as ButtonInteraction;
  } catch {
    await interaction.editReply({
      embeds: [errorEmbed('Bill submission timed out. Please run `/bill submit` again.')],
      components: [],
    });
    return;
  } finally {
    unregisterAwaitingInteraction(googleDocButtonId);
    unregisterAwaitingInteraction(shortButtonId);
  }

  const submissionType: BillSubmissionType = typeInteraction.customId.endsWith(':short')
    ? 'short'
    : 'google_doc';
  const isShortBill = submissionType === 'short';

  const modalId = `bill_submit_modal:${interaction.user.id}:${submissionType}`;

  // Open modal for text/summary/tags/policy areas
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(isShortBill ? 'Short Bill Details' : 'Bill Details');

  const googleDocInput = new TextInputBuilder()
    .setCustomId('google_doc_url')
    .setLabel('Google Doc URL')
    .setPlaceholder('https://docs.google.com/document/d/.../edit')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(512);

  const billTextInput = new TextInputBuilder()
    .setCustomId('bill_text')
    .setLabel('Bill Text')
    .setPlaceholder('Paste the full short bill text here...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(SHORT_BILL_TEXT_MAX_LENGTH);

  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Summary (TL;DR)')
    .setPlaceholder('Brief description of what the bill does...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  const tagsInput = new TextInputBuilder()
    .setCustomId('tags')
    .setLabel('Tags (comma-separated)')
    .setPlaceholder('e.g. economy, trade, reform')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256);

  const policyAreasInput = new TextInputBuilder()
    .setCustomId('policy_areas')
    .setLabel('Policy Areas (comma-separated)')
    .setPlaceholder('e.g. fiscal policy, foreign trade')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256);

  const rows = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      isShortBill ? billTextInput : googleDocInput,
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(policyAreasInput),
  ];

  modal.addComponents(...rows);

  await typeInteraction.showModal(modal);
  await interaction.editReply({
    embeds: [successEmbed(
      isShortBill ? 'Short Bill Selected' : 'Google Doc Selected',
      'Fill out the modal to finish submitting the bill.',
    )],
    components: [],
  });

  // Wait for modal submission
  let modalSubmit: ModalSubmitInteraction;
  registerAwaitingInteraction(modalId);
  try {
    modalSubmit = await typeInteraction.awaitModalSubmit({
      filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
      time: 300_000,
    });
  } catch {
    return; // Modal timed out
  } finally {
    unregisterAwaitingInteraction(modalId);
  }

  await modalSubmit.deferReply({ ephemeral: true });

  const { summary, tags, policyAreas } = parseModalMetadata(modalSubmit);
  const googleDocUrl = isShortBill ? null : modalSubmit.fields.getTextInputValue('google_doc_url').trim();
  const shortBillText = isShortBill ? modalSubmit.fields.getTextInputValue('bill_text').trim() : null;

  if (!isShortBill && !(googleDocUrl && isValidGoogleDocUrl(googleDocUrl))) {
    await modalSubmit.editReply({
      embeds: [errorEmbed('That doesn\'t look like a valid Google Docs URL. Expected format: `https://docs.google.com/document/d/.../edit`')],
    });
    return;
  }

  const docId = googleDocUrl ? extractDocId(googleDocUrl) : null;

  if (isShortBill && !shortBillText) {
    await modalSubmit.editReply({
      embeds: [errorEmbed('Short bills need bill text.')],
    });
    return;
  }

  try {
    // Ensure player exists
    const player = await findSubmittingPlayer(interaction.user.id);

    if (!player) {
      await modalSubmit.editReply({
        embeds: [errorEmbed('You need to create a character first. Use `/character create`.')],
      });
      return;
    }

    const finalSlug = await uniqueBillSlug(title);
    const now = new Date();

    // Bill insert + status-log insert must be atomic: if the audit row
    // fails to write, the bill row should not be persisted (otherwise
    // the user sees a "Failed to submit" error even though the bill
    // exists, with no `submitted` audit entry).
    const bill = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(bills)
        .values({
          title,
          slug: finalSlug,
          billType: isShortBill ? 'short' : 'google_doc',
          googleDocUrl,
          googleDocId: docId,
          cachedContent: isShortBill ? shortBillText : null,
          cachedAt: isShortBill ? now : null,
          summary,
          authorId: player.id,
          submittedById: player.id,
          status: 'submitted',
          tags,
          policyAreas,
          coSponsorIds: [],
        })
        .returning({
          id: bills.id,
          billNumber: bills.billNumber,
        });

      await tx.insert(billStatusLog).values({
        billId: inserted.id,
        fromStatus: null,
        toStatus: 'submitted',
        changedById: player.id,
      });

      return inserted;
    });

    const embed = successEmbed(
      isShortBill ? 'Short Bill Submitted' : 'Bill Submitted',
      [
        `**${title}**`,
        `Bill #\`${bill.billNumber}\``,
        '',
        summary ? `> ${summary}` : '',
        '',
        isShortBill
          ? `**Type:** Short bill`
          : `**Google Doc:** [View Document](${googleDocUrl})`,
        isShortBill ? `Use \`/bill view bill_number:${bill.billNumber}\` to read it.` : '',
        tags.length > 0 ? `**Tags:** ${tags.join(', ')}` : '',
        policyAreas.length > 0 ? `**Policy Areas:** ${policyAreas.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
    );

    await modalSubmit.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to submit bill:', error);
    await modalSubmit.editReply({
      embeds: [errorEmbed('Failed to submit bill due to a database error. Please try again or contact staff.')],
    });
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill')
    .setDescription('Legislative bill management')
    .addSubcommand((sub) =>
      sub
        .setName('submit')
        .setDescription('Submit a new bill for consideration')
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('The title of the bill')
            .setRequired(true)
            .setMaxLength(256),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('submit-for')
        .setDescription('Submit a bill on behalf of another player (Chancellor/staff only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player who authored the bill')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('The title of the bill')
            .setRequired(true)
            .setMaxLength(256),
        )
        .addStringOption((opt) =>
          opt
            .setName('google_doc_url')
            .setDescription('Google Doc URL containing the bill text')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a bill by its number')
        .addIntegerOption((opt) =>
          opt
            .setName('bill_number')
            .setDescription('The bill number')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List recent bills with optional filters')
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Filter by status')
            .setRequired(false)
            .addChoices(...STATUS_CHOICES),
        )
        .addUserOption((opt) =>
          opt
            .setName('author')
            .setDescription('Filter by author')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search across all bills')
        .addStringOption((opt) =>
          opt
            .setName('query')
            .setDescription('Search term (searches title, summary, and content)')
            .setRequired(true)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit bill fields (author or staff)')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('field')
            .setDescription('Which field to edit')
            .setRequired(true)
            .addChoices(
              { name: 'title', value: 'title' },
              { name: 'summary', value: 'summary' },
              { name: 'text (short bills only)', value: 'text' },
              { name: 'policy_areas (comma-separated)', value: 'policy_areas' },
              { name: 'tags (comma-separated)', value: 'tags' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('value')
            .setDescription('New value (comma-separated for list fields)')
            .setRequired(true)
            .setMaxLength(SHORT_BILL_TEXT_MAX_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show the full status timeline of a bill')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('enact')
        .setDescription('Finalise a passed bill into law (staff or chancellor only)')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('repeal')
        .setDescription('Repeal a passed bill (staff or chancellor only)')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('amend')
        .setDescription('Submit an amendment to an existing bill or document')
        .addStringOption((opt) =>
          opt
            .setName('parent')
            .setDescription('Bill number or document slug to amend')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('url')
            .setDescription('Google Doc URL containing the amendment text')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('amend-effects')
        .setDescription('Adjust the estimated effects of a passed bill (staff or chancellor only)')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('effects')
            .setDescription('Free-form effect text (multi-line supported)')
            .setRequired(true)
            .setMaxLength(4000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('voters')
        .setDescription("Show who voted yea / nay / abstain on a bill's most recent legislative vote")
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reraise')
        .setDescription('Cancel a mistaken legislative vote and return a bill to submitted')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Audit note explaining why the bill is being re-raised')
            .setRequired(false)
            .setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('withdraw')
        .setDescription('Withdraw one of your submitted bills')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Optional reason to record in the bill history')
            .setRequired(false)
            .setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('recache')
        .setDescription('Request a re-fetch of the Google Doc content for a bill (author or staff)')
        .addStringOption((opt) =>
          opt
            .setName('bill')
            .setDescription('Bill number (e.g. B-001) or title')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('npc-vote')
        .setDescription('Enter NPC house vote result on a bill (staff only)')
        .addIntegerOption((opt) =>
          opt
            .setName('bill_number')
            .setDescription('The bill number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('yea')
            .setDescription('Number of yea votes')
            .setRequired(true)
            .setMinValue(0),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('nay')
            .setDescription('Number of nay votes')
            .setRequired(true)
            .setMinValue(0),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('abstain')
            .setDescription('Number of abstentions')
            .setRequired(true)
            .setMinValue(0),
        )
        .addStringOption((opt) =>
          opt
            .setName('notes')
            .setDescription('Optional notes about the NPC vote')
            .setRequired(false)
            .setMaxLength(500),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, {
      submit: { execute: executeSubmit },
      'submit-for': submitFor,
      view,
      list,
      search,
      edit,
      status,
      enact,
      repeal,
      amend,
      'amend-effects': amendEffects,
      voters,
      reraise,
      withdraw,
      recache,
      'npc-vote': npcVote,
    });
  },
};

export default command;
