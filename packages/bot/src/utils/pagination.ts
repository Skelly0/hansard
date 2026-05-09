import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';

export interface PaginatedEmbedOptions {
  /** The interaction that triggered this paginated response. */
  interaction: ChatInputCommandInteraction;
  /** Array of embeds, one per page. */
  pages: EmbedBuilder[];
  /** Timeout in milliseconds before buttons are disabled. Defaults to 120000 (2 min). */
  timeout?: number;
}

/**
 * Send a paginated embed with Previous / Next buttons.
 *
 * - Single-page responses are sent without buttons.
 * - Only the user who triggered the interaction can navigate pages.
 * - Buttons are disabled after timeout.
 */
export async function createPaginatedEmbed(
  options: PaginatedEmbedOptions,
): Promise<void> {
  const { interaction, pages, timeout = 120_000 } = options;

  if (pages.length === 0) {
    throw new Error('createPaginatedEmbed requires at least one page.');
  }

  // Stamp page numbers into footers
  for (let i = 0; i < pages.length; i++) {
    const existing = pages[i].data.footer?.text ?? '';
    const pageLabel = `Page ${i + 1}/${pages.length}`;
    const footerText = existing ? `${existing} | ${pageLabel}` : pageLabel;
    pages[i].setFooter({ text: footerText });
  }

  // Single page — no buttons needed
  if (pages.length === 1) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [pages[0]] });
    } else {
      await interaction.reply({ embeds: [pages[0]] });
    }
    return;
  }

  let currentPage = 0;

  const prevButton = new ButtonBuilder()
    .setCustomId('pagination_prev')
    .setLabel('\u25C0 Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextButton = new ButtonBuilder()
    .setCustomId('pagination_next')
    .setLabel('Next \u25B6')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pages.length <= 1);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    prevButton,
    nextButton,
  );

  let message: Message;

  if (interaction.deferred || interaction.replied) {
    message = await interaction.editReply({
      embeds: [pages[currentPage]],
      components: [row],
    });
  } else {
    message = await interaction.reply({
      embeds: [pages[currentPage]],
      components: [row],
      fetchReply: true,
    });
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.customId === 'pagination_prev' || i.customId === 'pagination_next',
    time: timeout,
  });

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== interaction.user.id) {
      await buttonInteraction.reply({
        content: 'Only the command author can use these pagination controls.',
        ephemeral: true,
      });
      return;
    }

    if (buttonInteraction.customId === 'pagination_prev') {
      currentPage = Math.max(0, currentPage - 1);
    } else if (buttonInteraction.customId === 'pagination_next') {
      currentPage = Math.min(pages.length - 1, currentPage + 1);
    }

    prevButton.setDisabled(currentPage === 0);
    nextButton.setDisabled(currentPage === pages.length - 1);

    await buttonInteraction.update({
      embeds: [pages[currentPage]],
      components: [row],
    });
  });

  collector.on('end', async () => {
    prevButton.setDisabled(true);
    nextButton.setDisabled(true);

    try {
      await interaction.editReply({
        embeds: [pages[currentPage]],
        components: [row],
      });
    } catch {
      // Token may have expired or message was deleted — ignore
    }
  });
}
