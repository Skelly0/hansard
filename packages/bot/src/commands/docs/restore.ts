import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db.js';
import { documents, documentVersions, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('document-restore')
    .setDescription('Restore a document to a previous version (staff only)')
    .addStringOption((opt) =>
      opt.setName('slug').setDescription('Document slug').setRequired(true).setMaxLength(256),
    )
    .addIntegerOption((opt) =>
      opt.setName('to-version').setDescription('Version number to restore').setRequired(true).setMinValue(1),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can restore documents.')] });
      return;
    }

    const slug = interaction.options.getString('slug', true).trim();
    const toVersion = interaction.options.getInteger('to-version', true);

    const [staffPlayer] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);
    if (!staffPlayer) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
      return;
    }

    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.slug, slug))
      .limit(1);
    if (!doc) {
      await interaction.editReply({ embeds: [errorEmbed(`Document not found: \`${slug}\``)] });
      return;
    }

    const [target] = await db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.versionNumber, toVersion)))
      .limit(1);
    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`Version v${toVersion} not found for this document.`)] });
      return;
    }

    if (toVersion === doc.currentVersion) {
      await interaction.editReply({ embeds: [errorEmbed(`Document is already at v${toVersion}.`)] });
      return;
    }

    if (!target.content) {
      await interaction.editReply({
        embeds: [errorEmbed(`Version v${toVersion} has no inline content to restore (it may be a Google Docs version).`)],
      });
      return;
    }

    const newVersion = doc.currentVersion + 1;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(documentVersions).values({
          documentId: doc.id,
          versionNumber: newVersion,
          content: target.content,
          changeDescription: `Rollback to v${toVersion}`,
          editedById: staffPlayer.id,
        });
        await tx
          .update(documents)
          .set({ content: target.content, currentVersion: newVersion, updatedAt: new Date() })
          .where(eq(documents.id, doc.id));
      });

      await interaction.editReply({
        embeds: [successEmbed(
          'Document Restored',
          [
            `**${doc.title}** (\`${slug}\`)`,
            `Restored content from **v${toVersion}** as new **v${newVersion}**.`,
          ].join('\n'),
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore document';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
