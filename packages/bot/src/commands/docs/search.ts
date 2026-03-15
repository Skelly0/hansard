import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ilike, or, desc } from 'drizzle-orm';
import { db } from '../../db.js';
import { documents } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import type { Command } from '../../client.js';

const RESULTS_PER_PAGE = 5;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doc-search')
    .setDescription('Search across non-legislative documents')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Search term (searches title and content)')
        .setRequired(true)
        .setMaxLength(200),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const searchPattern = `%${query}%`;

    const results = await db
      .select()
      .from(documents)
      .where(
        or(
          ilike(documents.title, searchPattern),
          ilike(documents.content, searchPattern),
          ilike(documents.cachedContent, searchPattern),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(25);

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
          const tags = (doc.tags as string[] | null) ?? [];
          const tagStr = tags.length > 0 ? ` \u2014 ${tags.map((t) => `\`${t}\``).join(', ')}` : '';
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
  },
};

export default command;
