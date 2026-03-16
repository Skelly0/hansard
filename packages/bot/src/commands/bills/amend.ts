import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, documents, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { extractDocId } from './shared.js';

/**
 * Resolve the `parent` option to a bill or document.
 *
 * Resolution order:
 *   1. Parse as integer -> look up by bill_number
 *   2. Fall back to slug match on bills table
 *   3. Fall back to slug match on documents table
 */
async function resolveParent(parent: string): Promise<
  | { type: 'bill'; id: string; title: string; billNumber: number }
  | { type: 'document'; id: string; title: string }
  | null
> {
  // Try as bill number first
  const asNumber = Number(parent);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const [bill] = await db
      .select({ id: bills.id, title: bills.title, billNumber: bills.billNumber })
      .from(bills)
      .where(eq(bills.billNumber, asNumber))
      .limit(1);
    if (bill) return { type: 'bill', id: bill.id, title: bill.title, billNumber: bill.billNumber };
  }

  // Try as bill slug
  const [billBySlug] = await db
    .select({ id: bills.id, title: bills.title, billNumber: bills.billNumber })
    .from(bills)
    .where(eq(bills.slug, parent))
    .limit(1);
  if (billBySlug) return { type: 'bill', id: billBySlug.id, title: billBySlug.title, billNumber: billBySlug.billNumber };

  // Try as document slug
  const [doc] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(eq(documents.slug, parent))
    .limit(1);
  if (doc) return { type: 'document', id: doc.id, title: doc.title };

  return null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-amend')
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
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const parent = interaction.options.getString('parent', true);
    const url = interaction.options.getString('url', true);

    // Validate Google Doc URL
    const docId = extractDocId(url);
    if (!docId) {
      await interaction.reply({
        embeds: [errorEmbed('That doesn\'t look like a valid Google Docs URL. Expected format: `https://docs.google.com/document/d/.../edit`')],
        ephemeral: true,
      });
      return;
    }

    // Resolve parent bill or document
    const resolved = await resolveParent(parent);
    if (!resolved) {
      await interaction.reply({
        embeds: [errorEmbed(`Could not find a bill or document matching \`${parent}\`. Provide a bill number (e.g. \`42\`) or a document slug.`)],
        ephemeral: true,
      });
      return;
    }

    const amendsBillId = resolved.type === 'bill' ? resolved.id : '';
    const amendsDocumentId = resolved.type === 'document' ? resolved.id : '';

    // Build modal
    const modal = new ModalBuilder()
      .setCustomId(`amend_bill:${amendsBillId}:${amendsDocumentId}:${url}`)
      .setTitle('Amendment Details');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Amendment Title')
      .setPlaceholder('e.g. Amendment to the Trade Reform Act')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const summaryInput = new TextInputBuilder()
      .setCustomId('summary')
      .setLabel('Summary of Changes')
      .setPlaceholder('Brief description of what this amendment changes...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
    );

    await interaction.showModal(modal);

    // Wait for modal submission
    let modalSubmit: ModalSubmitInteraction;
    try {
      modalSubmit = await interaction.awaitModalSubmit({
        filter: (i) => i.customId === `amend_bill:${amendsBillId}:${amendsDocumentId}:${url}`,
        time: 300_000,
      });
    } catch {
      return; // Modal timed out
    }

    await modalSubmit.deferReply();

    const title = modalSubmit.fields.getTextInputValue('title').trim();
    const summary = modalSubmit.fields.getTextInputValue('summary').trim() || null;

    try {
      // Ensure player exists
      const [player] = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.discordId, interaction.user.id))
        .limit(1);

      if (!player) {
        await modalSubmit.editReply({
          embeds: [errorEmbed('You need to create a character first. Use `/character create`.')],
        });
        return;
      }

      // Generate slug
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200);

      // Ensure unique slug
      let finalSlug = slug;
      let counter = 1;
      while (true) {
        const [existing] = await db
          .select({ id: bills.id })
          .from(bills)
          .where(eq(bills.slug, finalSlug))
          .limit(1);
        if (!existing) break;
        finalSlug = `${slug}-${counter}`;
        counter++;
      }

      // Insert the amendment bill
      const [bill] = await db
        .insert(bills)
        .values({
          title,
          slug: finalSlug,
          googleDocUrl: url,
          googleDocId: docId,
          summary,
          authorId: player.id,
          submittedById: player.id,
          status: 'submitted',
          amendsBillId: amendsBillId || null,
          amendsDocumentId: amendsDocumentId || null,
          tags: [],
          policyAreas: [],
          coSponsorIds: [],
        })
        .returning();

      // Log status
      await db.insert(billStatusLog).values({
        billId: bill.id,
        fromStatus: null,
        toStatus: 'submitted',
        changedById: player.id,
        notes: `Amendment to ${resolved.type === 'bill' ? `Bill #${resolved.billNumber}` : resolved.title}`,
      });

      // Build notification embed
      const parentLabel = resolved.type === 'bill'
        ? `Bill #\`${resolved.billNumber}\` — ${resolved.title}`
        : resolved.title;

      const embed = createEmbed({
        title: 'Amendment Submitted',
        system: 'bills',
        description: [
          `**${title}**`,
          `Bill #\`${bill.billNumber}\``,
          '',
          `**Amends:** ${parentLabel}`,
          summary ? `> ${summary}` : '',
          '',
          `**Google Doc:** [View Amendment](${url})`,
          `**Submitted by:** <@${interaction.user.id}>`,
        ].filter(Boolean).join('\n'),
      });

      // Post to legislation channel if configured
      const legislationChannelId = process.env.LEGISLATION_CHANNEL_ID;
      if (legislationChannelId) {
        try {
          const channel = await interaction.client.channels.fetch(legislationChannelId);
          if (channel && 'send' in channel) {
            await (channel as TextChannel).send({ embeds: [embed] });
          }
        } catch (channelErr) {
          console.error('Failed to post amendment to legislation channel:', channelErr);
        }
      }

      await modalSubmit.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to submit amendment:', error);
      await modalSubmit.editReply({
        embeds: [errorEmbed('Failed to submit amendment due to a database error. Please try again or contact staff.')],
      });
    }
  },
};

export default command;
