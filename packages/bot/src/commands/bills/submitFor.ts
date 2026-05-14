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
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff, hasPermission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { extractDocId } from './shared.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-submit-for')
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
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    if (!member) {
      await interaction.reply({
        embeds: [errorEmbed('Could not resolve your guild membership.')],
        ephemeral: true,
      });
      return;
    }

    // Permission check: must be staff or have legislative_leader
    const staffCheck = await isStaff(member);
    if (!staffCheck) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can submit bills on behalf of other players.')],
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const title = interaction.options.getString('title', true);
    const googleDocUrl = interaction.options.getString('google_doc_url', true);

    // Validate Google Doc URL
    const docId = extractDocId(googleDocUrl);
    if (!docId) {
      await interaction.reply({
        embeds: [errorEmbed('That doesn\'t look like a valid Google Docs URL.')],
        ephemeral: true,
      });
      return;
    }

    // Open modal for summary, tags, policy areas
    const modal = new ModalBuilder()
      .setCustomId(`bill_submitfor_modal_${interaction.user.id}`)
      .setTitle('Bill Details (On Behalf)');

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

    let modalSubmit: ModalSubmitInteraction;
    try {
      modalSubmit = await interaction.awaitModalSubmit({
        filter: (i) => i.customId === `bill_submitfor_modal_${interaction.user.id}`,
        time: 300_000,
      });
    } catch {
      return;
    }

    await modalSubmit.deferReply();

    const summary = modalSubmit.fields.getTextInputValue('summary').trim() || null;
    const tagsRaw = modalSubmit.fields.getTextInputValue('tags').trim();
    const policyAreasRaw = modalSubmit.fields.getTextInputValue('policy_areas').trim();

    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const policyAreas = policyAreasRaw ? policyAreasRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    try {
      // Find both players
      const [author] = await db
        .select({ id: players.id, characterName: players.characterName })
        .from(players)
        .where(eq(players.discordId, targetUser.id))
        .limit(1);

      if (!author) {
        await modalSubmit.editReply({
          embeds: [errorEmbed(`**${targetUser.displayName}** doesn't have a character yet.`)],
        });
        return;
      }

      const [submitter] = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.discordId, interaction.user.id))
        .limit(1);

      if (!submitter) {
        await modalSubmit.editReply({
          embeds: [errorEmbed('You need to create a character first.')],
        });
        return;
      }

      // Generate unique slug
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200);

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

      // Insert the bill and its initial status-log entry inside a single
      // transaction so we never end up with a bill row that has no
      // corresponding bill_status_log audit history.
      const bill = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(bills)
          .values({
            title,
            slug: finalSlug,
            googleDocUrl,
            googleDocId: docId,
            summary,
            authorId: author.id,
            submittedById: submitter.id,
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
          billId: created.id,
          fromStatus: null,
          toStatus: 'submitted',
          changedById: submitter.id,
          notes: `Submitted on behalf of ${author.characterName ?? targetUser.displayName}`,
        });

        return created;
      });

      const embed = successEmbed(
        'Bill Submitted (On Behalf)',
        [
          `**${title}**`,
          `Bill #\`${bill.billNumber}\``,
          '',
          `**Author:** ${author.characterName ?? targetUser.displayName} (<@${targetUser.id}>)`,
          `**Submitted by:** <@${interaction.user.id}>`,
          '',
          summary ? `> ${summary}` : '',
          '',
          `**Google Doc:** [View Document](${googleDocUrl})`,
        ].filter(Boolean).join('\n'),
      );

      await modalSubmit.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to submit bill on behalf:', error);
      await modalSubmit.editReply({
        embeds: [errorEmbed('Failed to submit bill due to a database error.')],
      });
    }
  },
};

export default command;
