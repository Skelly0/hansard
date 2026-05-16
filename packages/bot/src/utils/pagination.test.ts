import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createPaginatedEmbed } from './pagination.js';

describe('createPaginatedEmbed', () => {
  it('preserves extra action rows on single-page responses', async () => {
    const page = new EmbedBuilder().setTitle('Ticket #42');
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim:42')
        .setLabel('Claim')
        .setStyle(ButtonStyle.Primary),
    );
    const interaction = {
      deferred: true,
      replied: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      user: { id: 'user-1' },
    };

    await createPaginatedEmbed({
      interaction: interaction as any,
      pages: [page],
      actionRows: [actionRow],
    });

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [page],
      components: [actionRow],
    });
  });
});
