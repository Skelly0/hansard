import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { db } from '../../db.js';
import { searchDocuments } from '@hansard/api/services/documentService';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { isStaff } from '../../utils/permissions.js';

const RESULTS_PER_PAGE = 5;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const query = interaction.options.getString('query', true);
  const viewer = { isStaff: !!interaction.member && (await isStaff(interaction.member as any)) };
  const { documents: results } = await searchDocuments(db, query, undefined, 25, 0, viewer);

  if (results.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Document Search',
          description: `No documents found matching **"${query}"**.`,
          system: 'bills',
        }),
      ],
    });
    return;
  }

  const pages: EmbedBuilder[] = [];
  for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
    const chunk = results.slice(i, i + RESULTS_PER_PAGE);

    const description = chunk
      .map((doc) => {
        const tags = doc.tags ?? [];
        const tagStr = tags.length > 0 ? ` — ${tags.map((t) => `\`${t}\``).join(', ')}` : '';
        const preview = doc.content
          ? doc.content.length > 120
            ? doc.content.slice(0, 117) + '...'
            : doc.content
          : '*No content preview*';

        return [
          `**${doc.title}** (\`${doc.slug}\`)${tagStr}`,
          `> ${preview}`,
          '',
        ].join('\n');
      })
      .join('\n');

    pages.push(
      createEmbed({
        title: `Document Search: "${query}"`,
        description: `Found **${results.length}** result${results.length !== 1 ? 's' : ''}.\n\n${description}`,
        system: 'bills',
      }),
    );
  }

  await createPaginatedEmbed({ interaction, pages });
}
