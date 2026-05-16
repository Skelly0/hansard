import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ilike, or, desc } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { formatBillStatus, statusEmoji } from './shared.js';

const RESULTS_PER_PAGE = 5;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  const searchPattern = `%${query}%`;

  const results = await db
    .select()
    .from(bills)
    .where(
      or(
        ilike(bills.title, searchPattern),
        ilike(bills.summary, searchPattern),
        ilike(bills.cachedContent, searchPattern),
      ),
    )
    .orderBy(desc(bills.submittedAt))
    .limit(25);

  if (results.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Bill Search',
          description: `No bills found matching **"${query}"**.`,
          system: 'bills',
        }),
      ],
    });
    return;
  }

  // Build paginated embeds
  const pages: EmbedBuilder[] = [];
  for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
    const chunk = results.slice(i, i + RESULTS_PER_PAGE);

    const description = chunk
      .map((bill) => {
        const status = formatBillStatus(bill.status);
        const emoji = statusEmoji(bill.status);
        const summary = bill.summary
          ? bill.summary.length > 100
            ? bill.summary.slice(0, 97) + '...'
            : bill.summary
          : '*No summary*';
        const title = bill.googleDocUrl
          ? `[${bill.title}](${bill.googleDocUrl})`
          : `${bill.title} *(short bill)*`;

        return [
          `**#${bill.billNumber}** — ${title}`,
          `${emoji} ${status}`,
          `> ${summary}`,
          '',
        ].join('\n');
      })
      .join('\n');

    pages.push(
      createEmbed({
        title: `Bill Search: "${query}"`,
        description: `Found **${results.length}** result${results.length !== 1 ? 's' : ''}.\n\n${description}`,
        system: 'bills',
      }),
    );
  }

  await createPaginatedEmbed({ interaction, pages });
}
