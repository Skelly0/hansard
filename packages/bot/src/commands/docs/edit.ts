import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { documents, documentVersions, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('document-edit')
    .setDescription('Edit a document by slug — bumps version (staff only)')
    .addStringOption((opt) =>
      opt.setName('slug').setDescription('Document slug').setRequired(true).setMaxLength(256),
    )
    .addStringOption((opt) =>
      opt.setName('content').setDescription('New document content').setRequired(true).setMaxLength(4000),
    )
    .addStringOption((opt) =>
      opt.setName('change-description').setDescription('What changed and why').setRequired(false).setMaxLength(512),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can edit documents.')] });
      return;
    }

    const slug = interaction.options.getString('slug', true).trim();
    const content = interaction.options.getString('content', true);
    const changeDescription = interaction.options.getString('change-description')?.trim() || null;

    const [staffPlayer] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);
    if (!staffPlayer) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
      return;
    }

    const [existing] = await db
      .select()
      .from(documents)
      .where(eq(documents.slug, slug))
      .limit(1);
    if (!existing) {
      await interaction.editReply({ embeds: [errorEmbed(`Document not found: \`${slug}\``)] });
      return;
    }

    const newVersion = existing.currentVersion + 1;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(documentVersions).values({
          documentId: existing.id,
          versionNumber: newVersion,
          content,
          changeDescription,
          editedById: staffPlayer.id,
        });
        await tx
          .update(documents)
          .set({ content, currentVersion: newVersion, updatedAt: new Date() })
          .where(eq(documents.id, existing.id));
      });

      await interaction.editReply({
        embeds: [successEmbed(
          'Document Updated',
          [
            `**${existing.title}** (\`${slug}\`)`,
            `Version: v${existing.currentVersion} → **v${newVersion}**`,
            changeDescription ? `**Change:** ${changeDescription}` : '',
          ].filter(Boolean).join('\n'),
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update document';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
