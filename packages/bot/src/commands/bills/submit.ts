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
import { SHORT_BILL_TEXT_MAX_LENGTH } from './display.js';
import { extractDocId } from './shared.js';

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
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'submit') return;

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
    const docId = googleDocUrl ? extractDocId(googleDocUrl) : null;
    const shortBillText = isShortBill ? modalSubmit.fields.getTextInputValue('bill_text').trim() : null;

    if (!isShortBill && !docId) {
      await modalSubmit.editReply({
        embeds: [errorEmbed('That doesn\'t look like a valid Google Docs URL. Expected format: `https://docs.google.com/document/d/.../edit`')],
      });
      return;
    }

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
          isShortBill ? `Use \`/bill-view bill_number:${bill.billNumber}\` to read it.` : '',
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
  },
};

export default command;
