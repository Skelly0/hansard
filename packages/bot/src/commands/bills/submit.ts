import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, players } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { extractDocId } from './shared.js';

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
        )
        .addStringOption((opt) =>
          opt
            .setName('google_doc_url')
            .setDescription('Google Doc URL containing the bill text')
            .setRequired(true),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'submit') return;

    const title = interaction.options.getString('title', true);
    const googleDocUrl = interaction.options.getString('google_doc_url', true);

    // Validate Google Doc URL
    const docId = extractDocId(googleDocUrl);
    if (!docId) {
      await interaction.reply({
        embeds: [errorEmbed('That doesn\'t look like a valid Google Docs URL. Expected format: `https://docs.google.com/document/d/.../edit`')],
        ephemeral: true,
      });
      return;
    }

    // Open modal for summary, tags, policy areas
    const modal = new ModalBuilder()
      .setCustomId(`bill_submit_modal_${interaction.user.id}`)
      .setTitle('Bill Details');

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

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(tagsInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(policyAreasInput),
    );

    await interaction.showModal(modal);

    // Wait for modal submission
    let modalSubmit: ModalSubmitInteraction;
    try {
      modalSubmit = await interaction.awaitModalSubmit({
        filter: (i) => i.customId === `bill_submit_modal_${interaction.user.id}`,
        time: 300_000,
      });
    } catch {
      return; // Modal timed out
    }

    await modalSubmit.deferReply();

    const summary = modalSubmit.fields.getTextInputValue('summary').trim() || null;
    const tagsRaw = modalSubmit.fields.getTextInputValue('tags').trim();
    const policyAreasRaw = modalSubmit.fields.getTextInputValue('policy_areas').trim();

    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const policyAreas = policyAreasRaw ? policyAreasRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

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

      // Insert the bill
      const [bill] = await db
        .insert(bills)
        .values({
          title,
          slug: finalSlug,
          googleDocUrl,
          googleDocId: docId,
          summary,
          authorId: player.id,
          submittedById: player.id,
          status: 'submitted',
          tags,
          policyAreas,
          coSponsorIds: [],
        })
        .returning();

      // Log status
      await db.insert(billStatusLog).values({
        billId: bill.id,
        fromStatus: null,
        toStatus: 'submitted',
        changedById: player.id,
      });

      const embed = successEmbed(
        'Bill Submitted',
        [
          `**${title}**`,
          `Bill #\`${bill.billNumber}\``,
          '',
          summary ? `> ${summary}` : '',
          '',
          `**Google Doc:** [View Document](${googleDocUrl})`,
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
