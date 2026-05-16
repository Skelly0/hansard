import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { db } from '../../db.js';
import { getCollections, listDocuments } from '@hansard/api/services/documentService';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { isStaff } from '../../utils/permissions.js';

const RESULTS_PER_PAGE = 8;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const collectionFilter = interaction.options.getString('collection');
  const viewer = { isStaff: !!interaction.member && (await isStaff(interaction.member as any)) };
  const collections = await getCollections(db, viewer);

  // If a collection name was given, find its ID
  let collectionId: string | null = null;
  let collectionName: string | null = null;

  if (collectionFilter) {
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

  const { documents: results } = await listDocuments(
    db,
    { collectionId: collectionId ?? undefined, limit: 50 },
    viewer,
  );

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

  const collectionMap = new Map(collections.map((c) => [c.id, c.name]));

  // Build paginated embeds
  const pages: EmbedBuilder[] = [];
  for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
    const chunk = results.slice(i, i + RESULTS_PER_PAGE);

    const lines = chunk.map((doc) => {
      const cName = collectionMap.get(doc.collectionId) ?? 'Unknown';
      const tags = doc.tags ?? [];
      const tagStr = tags.length > 0 ? ` ${tags.map((t) => `\`${t}\``).join(', ')}` : '';
      return `**${doc.title}** (\`${doc.slug}\`)\n  ${cName} — v${doc.currentVersion}${tagStr}`;
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
}
