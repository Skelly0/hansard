import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  ChannelType,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from 'discord.js';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { buildTicketSummaryEmbed, buildTicketActionRow } from '../../components/ticketButtons.js';

/**
 * /ticket create
 *
 * Flow:
 * 1. Bot replies with a category select menu (ephemeral)
 * 2. Player picks a category
 * 3. Modal opens with title + description fields
 * 4. On submit: ticket is created, Discord thread opened, summary pinned
 *
 * NOTE: The actual DB write uses a fetch to the API. In a future iteration
 * this could use a shared service directly. For now, the ticket creation
 * logic is inlined here so the bot works standalone during development.
 */

/** Placeholder categories until API/DB is wired up. */
const DEFAULT_CATEGORIES = [
  { id: 'general', name: 'General Enquiry', emoji: '\u2753', description: 'General questions or requests' },
  { id: 'bug', name: 'Bug Report', emoji: '\uD83D\uDC1B', description: 'Report a bug or issue' },
  { id: 'character', name: 'Character Request', emoji: '\uD83D\uDC64', description: 'Character creation, changes, or issues' },
  { id: 'rules', name: 'Rules Question', emoji: '\uD83D\uDCDA', description: 'Rules clarifications or disputes' },
  { id: 'suggestion', name: 'Suggestion', emoji: '\uD83D\uDCA1', description: 'Ideas and suggestions' },
];

const TICKET_CHANNEL_ENV = 'TICKET_CHANNEL_ID';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system commands')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create a new support ticket'),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== 'create') return;

    // Step 1: Show category selection
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_category_select:${interaction.user.id}`)
      .setPlaceholder('Select a ticket category...')
      .addOptions(
        DEFAULT_CATEGORIES.map((cat) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(cat.name)
            .setDescription(cat.description)
            .setValue(cat.id)
            .setEmoji(cat.emoji),
        ),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const reply = await interaction.reply({
      embeds: [
        createEmbed({
          title: 'Create a Ticket',
          description: 'Select a category for your ticket below.',
          system: 'tickets',
        }),
      ],
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    // Step 2: Wait for category selection
    let categoryInteraction: StringSelectMenuInteraction;
    try {
      categoryInteraction = await reply.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000,
      }) as StringSelectMenuInteraction;
    } catch {
      await interaction.editReply({
        embeds: [errorEmbed('Ticket creation timed out. Please try again.')],
        components: [],
      });
      return;
    }

    const selectedCategoryId = categoryInteraction.values[0];
    const selectedCategory = DEFAULT_CATEGORIES.find((c) => c.id === selectedCategoryId)!;

    // Step 3: Open modal
    const modal = new ModalBuilder()
      .setCustomId(`ticket_create_modal:${selectedCategoryId}`)
      .setTitle(`New Ticket: ${selectedCategory.name}`);

    const titleInput = new TextInputBuilder()
      .setCustomId('ticket_title')
      .setLabel('Title')
      .setPlaceholder('Brief summary of your issue')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('ticket_description')
      .setLabel('Description')
      .setPlaceholder('Describe your issue in detail...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    );

    await categoryInteraction.showModal(modal);

    // Step 4: Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await categoryInteraction.awaitModalSubmit({
        filter: (i) => i.customId === `ticket_create_modal:${selectedCategoryId}`,
        time: 300_000, // 5 minutes to fill out
      });
    } catch {
      // Modal timed out — no way to follow up since the original was ephemeral
      return;
    }

    await modalInteraction.deferReply({ ephemeral: true });

    const title = modalInteraction.fields.getTextInputValue('ticket_title');
    const description = modalInteraction.fields.getTextInputValue('ticket_description');

    // Create the ticket data (will be persisted via API/DB when wired up)
    const ticketNumber = Math.floor(Math.random() * 9000) + 1000; // placeholder
    const memberDisplayName =
      interaction.member && 'displayName' in interaction.member
        ? interaction.member.displayName
        : interaction.user.displayName;
    const ticketData = {
      number: ticketNumber,
      title,
      description,
      category: selectedCategory,
      status: 'open' as const,
      priority: 'normal' as const,
      createdBy: {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: memberDisplayName,
      },
      assignedTo: null as { id: string; displayName: string } | null,
      createdAt: new Date().toISOString(),
      tags: [] as string[],
    };

    // Step 5: Create Discord thread
    const ticketChannelId = process.env[TICKET_CHANNEL_ENV];
    let threadId: string | undefined;

    if (ticketChannelId && interaction.guild) {
      try {
        const channel = await interaction.guild.channels.fetch(ticketChannelId);

        if (channel?.type === ChannelType.GuildText) {
          const thread = await (channel as TextChannel).threads.create({
            name: `#${ticketNumber} — ${title.slice(0, 80)}`,
            type: ChannelType.PrivateThread,
            reason: `Ticket #${ticketNumber} created by ${interaction.user.username}`,
          });

          threadId = thread.id;

          // Add the ticket creator to the thread
          await thread.members.add(interaction.user.id);

          // Pin the summary embed
          const summaryEmbed = buildTicketSummaryEmbed(ticketData);
          const actionRow = buildTicketActionRow(ticketNumber);
          const pinMessage = await thread.send({
            embeds: [summaryEmbed],
            components: [actionRow],
          });
          await pinMessage.pin();

          // Send initial description as a message
          await thread.send({
            content: `**${interaction.user.displayName}** opened this ticket:\n\n${description}`,
          });
        }
      } catch (err) {
        console.error('Failed to create ticket thread:', err);
        // Thread creation failed but ticket still created — not fatal
      }
    }

    // Step 6: Confirm to user
    const confirmEmbed = successEmbed(
      `Ticket #${ticketNumber} Created`,
      [
        `**Category:** ${selectedCategory.emoji} ${selectedCategory.name}`,
        `**Title:** ${title}`,
        threadId ? `**Thread:** <#${threadId}>` : '',
        '',
        'A staff member will review your ticket shortly.',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    await modalInteraction.editReply({ embeds: [confirmEmbed] });
  },
};

export default command;
