import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players } from '@hansard/db';
import { getCollections, getDocument } from '@hansard/api/services/documentService';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/** Max characters per embed page for document content. */
const CONTENT_PAGE_SIZE = 1800;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doc-view')
    .setDescription('View a document')
    .addStringOption((opt) =>
      opt
        .setName('slug')
        .setDescription('The document slug (e.g. "constitution")')
        .setRequired(true)
        .setMaxLength(256),
  ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const slug = interaction.options.getString('slug', true);
    const viewer = { isStaff: !!interaction.member && (await isStaff(interaction.member as any)) };

    const doc = await getDocument(db, slug, viewer);

    if (!doc) {
      await interaction.editReply({
        embeds: [errorEmbed(`Document not found: \`${slug}\``)],
      });
      return;
    }

    // Fetch collection name
    let collectionName = 'Unknown';
    if (doc.collectionId) {
      const collection = (await getCollections(db, viewer)).find((c) => c.id === doc.collectionId);
      if (collection) collectionName = collection.name;
    }

    // Fetch author name
    let authorName: string | null = null;
    if (doc.authorId) {
      const [author] = await db
        .select({ characterName: players.characterName, discordId: players.discordId })
        .from(players)
        .where(eq(players.id, doc.authorId))
        .limit(1);
      if (author) {
        authorName = author.characterName ?? `<@${author.discordId}>`;
      }
    }

    const content = doc.content ?? doc.cachedContent ?? '*No content available.*';
    const tags = doc.tags ?? [];

    // Build header fields
    const fields = [
      { name: 'Collection', value: collectionName, inline: true },
      { name: 'Version', value: `v${doc.currentVersion}`, inline: true },
    ];

    if (authorName) {
      fields.push({ name: 'Author', value: authorName, inline: true });
    }

    if (tags.length > 0) {
      fields.push({
        name: 'Tags',
        value: tags.map((t) => `\`${t}\``).join(', '),
        inline: true,
      });
    }

    if (doc.googleDocUrl) {
      fields.push({
        name: 'Source',
        value: `[Google Doc](${doc.googleDocUrl})`,
        inline: true,
      });
    }

    // If content is short enough, single page
    if (content.length <= CONTENT_PAGE_SIZE) {
      const embed = createEmbed({
        title: doc.title,
        description: content,
        system: 'bills',
        fields,
        url: doc.googleDocUrl ?? undefined,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Paginate long content
    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < content.length; i += CONTENT_PAGE_SIZE) {
      const chunk = content.slice(i, i + CONTENT_PAGE_SIZE);
      const isFirst = i === 0;

      const embed = createEmbed({
        title: doc.title,
        description: chunk,
        system: 'bills',
        fields: isFirst ? fields : undefined,
        url: doc.googleDocUrl ?? undefined,
      });

      pages.push(embed);
    }

    await createPaginatedEmbed({ interaction, pages });
  },
};

export default command;
