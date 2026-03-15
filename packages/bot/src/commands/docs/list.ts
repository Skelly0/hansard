import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, and, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { documents, documentCollections } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import type { Command } from '../../client.js';

const RESULTS_PER_PAGE = 8;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doc-list')
    .setDescription('Browse documents by collection')
    .addStringOption((opt) =>
      opt
        .setName('collection')
        .setDescription('Filter by collection name (optional)')
        .setRequired(false)
        .setMaxLength(128),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const collectionFilter = interaction.options.getString('collection');

    // If a collection name was given, find its ID
    let collectionId: string | null = null;
    let collectionName: string | null = null;

    if (collectionFilter) {
      const collections = await db
        .select({ id: documentCollections.id, name: documentCollections.name })
        .from(documentCollections);

      // Case-insensitive match
      const match = collections.find(
        (c) => c.name.toLowerCase() === collectionFilter.toLowerCase(),
      );

      if (!match) {
        // Show available collections
        const names = collections.map((c) => `\`${c.name}\``).join(', ');
        await interaction.editReply({
          embeds: [
            createEmbed({
              title: 'Documents',
              description: `Collection **"${collectionFilter}"** not found.\n\nAvailable collections: ${names || '*none*'}`,
              system: 'bills',
            }),
          ],
        });
        return;
      }

      collectionId = match.id;
      collectionName = match.name;
    }

    // Build query
    const conditions: SQL[] = [];
    if (collectionId) {
      conditions.push(eq(documents.collectionId, collectionId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select()
      .from(documents)
      .where(whereClause)
      .orderBy(desc(documents.updatedAt))
      .limit(50);

    if (results.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Documents',
            description: collectionName
              ? `No documents found in collection **${collectionName}**.`
              : 'No documents have been created yet.',
            system: 'bills',
          }),
        ],
      });
      return;
    }

    // Also fetch all collections for display
    const allCollections = await db
      .select({ id: documentCollections.id, name: documentCollections.name })
      .from(documentCollections);

    const collectionMap = new Map(allCollections.map((c) => [c.id, c.name]));

    // Build paginated embeds
    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
      const chunk = results.slice(i, i + RESULTS_PER_PAGE);

      const lines = chunk.map((doc) => {
        const cName = collectionMap.get(doc.collectionId) ?? 'Unknown';
        const tags = (doc.tags as string[] | null) ?? [];
        const tagStr = tags.length > 0 ? ` ${tags.map((t) => `\`${t}\``).join(', ')}` : '';
        return `**${doc.title}** (\`${doc.slug}\`)\n\u2003\u2003${cName} \u2014 v${doc.currentVersion}${tagStr}`;
      });

      pages.push(
        createEmbed({
          title: collectionName ? `Documents: ${collectionName}` : 'Documents',
          description: [
            `Showing **${results.length}** document${results.length !== 1 ? 's' : ''}.\n`,
            ...lines,
          ].join('\n'),
          system: 'bills',
        }),
      );
    }

    await createPaginatedEmbed({ interaction, pages });
  },
};

export default command;
