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
  TextChannel,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { asc, eq } from 'drizzle-orm';
import {
  ticketCategories,
  tickets,
  ticketMessages,
  ticketAuditLog,
  players,
} from '@hansard/db';
import { TicketStatus, TicketPriority } from '@hansard/shared';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { buildTicketSummaryEmbed, buildTicketActionRow } from '../../components/ticketButtons.js';
import {
  buildTicketCategoryCreatedDescription,
  buildTicketCategoryFields,
  normalizeTicketCategoryInput,
} from './categoryHelpers.js';

/**
 * /ticket create
 *
 * Flow:
 * 1. Bot replies with a category select menu (ephemeral) — categories from DB.
 * 2. Player picks a category.
 * 3. Modal opens with title + description fields.
 * 4. On submit: ticket is persisted to Postgres atomically (tickets +
 *    initial ticketMessages + ticketAuditLog), then a Discord thread is
 *    opened (best-effort) and updated with the real thread id.
 *
 * Persistence is direct-Drizzle per CLAUDE.md. This command does not call
 * the API layer.
 */

const TICKET_CHANNEL_ENV = 'TICKET_CHANNEL_ID';
const DEFAULT_EMOJI = '📋'; // 📋 — fallback when category has no emoji

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system commands')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create a new support ticket'),
    )
    .addSubcommand((sub) =>
      sub.setName('categories').setDescription('List active ticket categories'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('category-create')
        .setDescription('Create a ticket category (staff only)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Display name, e.g. Appeals')
            .setRequired(true)
            .setMaxLength(64),
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('What this category is for')
            .setRequired(false)
            .setMaxLength(2000),
        )
        .addStringOption((opt) =>
          opt
            .setName('emoji')
            .setDescription('Emoji used in embeds and menus')
            .setRequired(false)
            .setMaxLength(8),
        )
        .addStringOption((opt) =>
          opt
            .setName('colour')
            .setDescription('Hex colour for UI, e.g. #7B8BA8')
            .setRequired(false)
            .setMaxLength(7),
        )
        .addStringOption((opt) =>
          opt
            .setName('assignable-roles')
            .setDescription('Comma-separated staff role names for this category')
            .setRequired(false)
            .setMaxLength(512),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('sort-order')
            .setDescription('Display order; lower appears first')
            .setRequired(false)
            .setMinValue(0),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'categories') {
      await handleCategories(interaction);
      return;
    }

    if (subcommand === 'category-create') {
      await handleCategoryCreate(interaction);
      return;
    }

    if (subcommand !== 'create') return;

    // Step 0: Load active categories from DB.
    const categoryRows = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.isActive, true))
      .orderBy(asc(ticketCategories.sortOrder));

    if (categoryRows.length === 0) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'No ticket categories are configured. Ask staff to seed `ticket_categories` before opening a ticket.',
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    // Discord caps select-menu options at 25.
    const visibleCategories = categoryRows.slice(0, 25);

    // Step 1: Show category selection.
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_category_select:${interaction.user.id}`)
      .setPlaceholder('Select a ticket category...')
      .addOptions(
        visibleCategories.map((cat) => {
          const opt = new StringSelectMenuOptionBuilder()
            .setLabel(cat.name)
            .setValue(cat.id);
          if (cat.description) {
            opt.setDescription(cat.description.slice(0, 100));
          }
          if (cat.emoji) {
            opt.setEmoji(cat.emoji);
          }
          return opt;
        }),
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

    // Step 2: Wait for category selection.
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
    const selectedCategory = visibleCategories.find((c) => c.id === selectedCategoryId);

    if (!selectedCategory) {
      await categoryInteraction.update({
        embeds: [errorEmbed('That category is no longer available. Please try again.')],
        components: [],
      });
      return;
    }

    // Step 3: Open modal.
    const modalCustomId = `ticket_create_modal:${interaction.user.id}:${selectedCategoryId}`;
    const modal = new ModalBuilder()
      .setCustomId(modalCustomId)
      .setTitle(`New Ticket: ${selectedCategory.name.slice(0, 32)}`);

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

    // Step 4: Wait for modal submission.
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await categoryInteraction.awaitModalSubmit({
        filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
        time: 300_000, // 5 minutes to fill out
      });
    } catch {
      // Modal timed out — no way to follow up since the original was ephemeral.
      return;
    }

    await modalInteraction.deferReply({ ephemeral: true });

    const title = modalInteraction.fields.getTextInputValue('ticket_title').trim();
    const description = modalInteraction.fields.getTextInputValue('ticket_description').trim();
    const creatorDiscordId = modalInteraction.user.id;
    const creatorDiscordUsername = modalInteraction.user.username;

    // Step 5: Resolve creator — auto-create on first contact (mirrors the
    // OAuth callback's findOrCreatePlayerByDiscordId pattern). This command
    // keeps the upsert inlined instead of calling the API layer.
    let creator;
    try {
      const [upserted] = await db
        .insert(players)
        .values({
          discordId: creatorDiscordId,
          discordUsername: creatorDiscordUsername,
        })
        .onConflictDoUpdate({
          target: players.discordId,
          set: { discordUsername: creatorDiscordUsername },
        })
        .returning();
      creator = upserted;
    } catch (err) {
      console.error('Failed to resolve creator player for ticket:', err);
      await modalInteraction.editReply({
        embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
      });
      return;
    }

    if (!creator) {
      await modalInteraction.editReply({
        embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
      });
      return;
    }

    // Step 6: Persist ticket atomically — tickets row + initial message + audit log.
    let inserted: typeof tickets.$inferSelect;
    try {
      inserted = await db.transaction(async (tx) => {
        const [ticketRow] = await tx
          .insert(tickets)
          .values({
            categoryId: selectedCategory.id,
            createdById: creator.id,
            title,
            description,
            status: TicketStatus.OPEN,
            priority: TicketPriority.NORMAL,
          })
          .returning();

        // The opening description doubles as the first conversation message
        // so the webapp transcript reads naturally.
        await tx.insert(ticketMessages).values({
          ticketId: ticketRow.id,
          authorId: creator.id,
          content: description,
          isInternal: false,
        });

        await tx.insert(ticketAuditLog).values({
          ticketId: ticketRow.id,
          actorId: creator.id,
          action: 'created',
          newValue: { title, categoryId: selectedCategory.id },
        });

        return ticketRow;
      });
    } catch (err) {
      console.error('Failed to persist ticket:', err);
      await modalInteraction.editReply({
        embeds: [errorEmbed('Failed to create ticket. Please try again or contact staff.')],
      });
      return;
    }

    const ticketNumber = inserted.number;
    const memberDisplayName =
      modalInteraction.member && 'displayName' in modalInteraction.member
        ? modalInteraction.member.displayName
        : modalInteraction.user.displayName || modalInteraction.user.username;

    // Step 7: Build the data shape ticketButtons expects.
    const ticketData = {
      number: ticketNumber,
      title,
      description,
      category: {
        name: selectedCategory.name,
        emoji: selectedCategory.emoji ?? DEFAULT_EMOJI,
      },
      status: inserted.status,
      priority: inserted.priority,
      createdBy: {
        id: creatorDiscordId,
        displayName: memberDisplayName,
      },
      assignedTo: null,
      createdAt: inserted.createdAt instanceof Date
        ? inserted.createdAt.toISOString()
        : new Date(inserted.createdAt as unknown as string).toISOString(),
      tags: [] as string[],
    };

    // Step 8: Best-effort Discord thread creation. If TICKET_CHANNEL_ID is
    // unset or thread creation fails, the ticket still exists in the DB.
    const ticketChannelId = process.env[TICKET_CHANNEL_ENV];
    let threadId: string | undefined;
    let threadChannelId: string | undefined;

    if (ticketChannelId && interaction.guild) {
      try {
        const channel = await interaction.guild.channels.fetch(ticketChannelId);

        if (channel instanceof TextChannel) {
          const thread = await channel.threads.create({
            name: `#${ticketNumber} — ${title.slice(0, 80)}`,
            type: ChannelType.PrivateThread,
            reason: `Ticket #${ticketNumber} created by ${creatorDiscordUsername}`,
          });

          threadId = thread.id;
          threadChannelId = channel.id;

          // Add the ticket creator to the thread.
          await thread.members.add(creatorDiscordId);

          // Pin the summary embed.
          const summaryEmbed = buildTicketSummaryEmbed(ticketData);
          const actionRow = buildTicketActionRow(ticketNumber);
          const pinMessage = await thread.send({
            embeds: [summaryEmbed],
            components: [actionRow],
          });
          await pinMessage.pin();

          // Send initial description as a message.
          await thread.send({
            content: `**${ticketData.createdBy.displayName}** opened this ticket:\n\n${description}`,
          });
        }
      } catch (err) {
        console.error('Failed to create ticket thread (ticket persisted):', err);
        // Thread creation failed but ticket still created — not fatal.
      }
    }

    // Step 9: Persist the Discord channel/thread ids back to the ticket row
    // so the webapp can deep-link into Discord.
    if (threadId) {
      try {
        await db
          .update(tickets)
          .set({
            discordThreadId: threadId,
            discordChannelId: threadChannelId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(tickets.id, inserted.id));
      } catch (err) {
        console.error('Failed to attach thread id to ticket:', err);
      }
    }

    // Step 10: Confirm to user.
    const confirmEmbed = successEmbed(
      `Ticket #${ticketNumber} Created`,
      [
        `**Category:** ${selectedCategory.emoji ? `${selectedCategory.emoji} ` : ''}${selectedCategory.name}`,
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

async function handleCategories(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const categories = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.isActive, true))
    .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.name));

  if (categories.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Ticket Categories',
          description: 'No ticket categories have been created yet. Staff can create one with `/ticket category-create`.',
          system: 'tickets',
        }),
      ],
    });
    return;
  }

  const maxEmbedFields = 25;
  const visibleCategories = categories.slice(0, maxEmbedFields);
  const hiddenCount = categories.length - visibleCategories.length;

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: 'Ticket Categories',
        description: [
          `${categories.length} active categor${categories.length === 1 ? 'y' : 'ies'}.`,
          hiddenCount > 0 ? `Showing the first ${maxEmbedFields}; ${hiddenCount} more are configured.` : '',
        ].filter(Boolean).join('\n'),
        system: 'tickets',
        fields: buildTicketCategoryFields(visibleCategories),
      }),
    ],
  });
}

async function handleCategoryCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can create ticket categories.')] });
    return;
  }

  let values;
  try {
    values = normalizeTicketCategoryInput({
      name: interaction.options.getString('name', true),
      description: interaction.options.getString('description'),
      emoji: interaction.options.getString('emoji'),
      colour: interaction.options.getString('colour'),
      assignableRoles: interaction.options.getString('assignable-roles'),
      sortOrder: interaction.options.getInteger('sort-order'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid category options.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    return;
  }

  try {
    const [category] = await db
      .insert(ticketCategories)
      .values(values)
      .returning();

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Ticket Category Created',
          buildTicketCategoryCreatedDescription(category),
        ),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create ticket category.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

export default command;
