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
  type Message,
  type MessageCreateOptions,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ThreadChannel,
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
import { sendTicketStaffPing } from '../../utils/ticketStaffPing.js';
import {
  registerAwaitingInteraction,
  unregisterAwaitingInteraction,
} from '../../utils/awaitingInteractions.js';
import type { Command } from '../../client.js';
import { dispatchSubcommand } from '../../utils/parentCommand.js';
import {
  buildTicketActionRow,
  buildTicketOpeningMessages,
  buildTicketSummaryEmbeds,
} from '../../components/ticketButtons.js';
import {
  buildTicketCategoryCreatedDescription,
  buildTicketCategoryFields,
  normalizeTicketCategoryInput,
} from './categoryHelpers.js';
import * as view from './view.js';
import * as list from './list.js';
import * as reply from './reply.js';
import * as close from './close.js';
import * as assign from './assign.js';
import * as priority from './priority.js';
import * as note from './note.js';
import * as link from './link.js';
import * as metrics from './metrics.js';

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
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a ticket by its number')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number (e.g. 1042)')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List tickets with optional filters')
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Filter by status')
            .setRequired(false)
            .addChoices(
              { name: 'Open', value: 'open' },
              { name: 'In Progress', value: 'in_progress' },
              { name: 'Waiting', value: 'waiting' },
              { name: 'Resolved', value: 'resolved' },
              { name: 'Closed', value: 'closed' },
            ),
        )
        .addUserOption((opt) =>
          opt
            .setName('assignee')
            .setDescription('Filter by assigned staff member')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reply')
        .setDescription('Reply to a ticket with a public message')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Your reply')
            .setRequired(true)
            .setMaxLength(2000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close a ticket')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Resolution note')
            .setRequired(false)
            .setMaxLength(1000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign a ticket to a staff member')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The staff member to assign')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('priority')
        .setDescription('Set a ticket priority level (staff only)')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName('level')
            .setDescription('Priority level')
            .setRequired(true)
            .addChoices(
              { name: 'Low', value: 'low' },
              { name: 'Normal', value: 'normal' },
              { name: 'High', value: 'high' },
              { name: 'Urgent', value: 'urgent' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('note')
        .setDescription('Add a staff-only internal note to a ticket')
        .addIntegerOption((opt) =>
          opt
            .setName('number')
            .setDescription('The ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('The internal note')
            .setRequired(true)
            .setMaxLength(2000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Link two tickets together (staff only)')
        .addIntegerOption((opt) =>
          opt
            .setName('a')
            .setDescription('First ticket number')
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('b')
            .setDescription('Second ticket number')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('metrics')
        .setDescription('Staff dashboard for ticket health'),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, {
      create: { execute: handleCreate },
      categories: { execute: handleCategories },
      'category-create': { execute: handleCategoryCreate },
      view,
      list,
      reply,
      close,
      assign,
      priority,
      note,
      link,
      metrics,
    });
  },
};

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
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
  const selectCustomId = `ticket_category_select:${interaction.user.id}`;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
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

  // Step 2: Wait for category selection. Use a 14-minute window to match
  // Discord's interaction-token lifetime — beyond that, Discord itself
  // would reject the click. The registry call lets the global handler
  // distinguish "in-flight" from "stale" if the user somehow exceeds it.
  let categoryInteraction: StringSelectMenuInteraction;
  registerAwaitingInteraction(selectCustomId);
  try {
    categoryInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: 840_000,
    }) as StringSelectMenuInteraction;
  } catch {
    await interaction.editReply({
      embeds: [errorEmbed('Ticket creation timed out. Please try again.')],
      components: [],
    });
    return;
  } finally {
    unregisterAwaitingInteraction(selectCustomId);
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

  // Step 4: Wait for modal submission. 14-minute window matches Discord's
  // own interaction-token lifetime; beyond that the modal token expires
  // anyway. The registry call keeps the global handler from acking this
  // submission while we're still in flight.
  let modalInteraction: ModalSubmitInteraction;
  registerAwaitingInteraction(modalCustomId);
  try {
    modalInteraction = await categoryInteraction.awaitModalSubmit({
      filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
      time: 840_000,
    });
  } catch {
    // Modal timed out — no way to follow up since the original was ephemeral.
    return;
  } finally {
    unregisterAwaitingInteraction(modalCustomId);
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

      const summaryEmbeds = buildTicketSummaryEmbeds(ticketData);
      const actionRow = buildTicketActionRow(ticketNumber);
      const threadName = buildTicketThreadName(ticketNumber, title);
      const reason = `Ticket #${ticketNumber} created by ${creatorDiscordUsername}`;

      if (isTextTicketChannel(channel)) {
        const thread = await channel.threads.create({
          name: threadName,
          type: ChannelType.PrivateThread,
          reason,
        });

        threadId = thread.id;
        threadChannelId = channel.id;

        await sendTicketStaffPing(thread, interaction.guild, ticketNumber);
        await sendTicketSummaryMessage(thread, summaryEmbeds, actionRow, ticketNumber);
        await sendOpeningTicketMessage(
          thread,
          ticketData.createdBy.displayName,
          description,
          ticketNumber,
        );
      } else if (channel) {
        console.warn(
          `Ticket channel ${ticketChannelId} has unsupported type ${'type' in channel ? channel.type : 'unknown'}; expected text channel.`,
        );
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
}

function buildTicketThreadName(ticketNumber: number, title: string): string {
  return `#${ticketNumber} — ${title.slice(0, 80)}`;
}

function isTextTicketChannel(channel: unknown): channel is TextChannel {
  return channel instanceof TextChannel;
}

async function sendTicketSummaryMessage(
  thread: Pick<ThreadChannel, 'send'>,
  summaryEmbeds: ReturnType<typeof buildTicketSummaryEmbeds>,
  actionRow: ReturnType<typeof buildTicketActionRow>,
  ticketNumber: number,
): Promise<void> {
  let summaryMessage: Message | null = null;

  try {
    // Summary embeds embed the creator's title/description verbatim. Suppress
    // all mention parsing so a ticket body can't @everyone or ping staff roles
    // via the bot token.
    summaryMessage = await thread.send({
      embeds: summaryEmbeds.slice(0, 10),
      components: [actionRow],
      allowedMentions: { parse: [] },
    } satisfies MessageCreateOptions);
  } catch (err) {
    console.error(`Failed to post summary for ticket #${ticketNumber}:`, err);
    return;
  }

  try {
    await summaryMessage.pin();
  } catch (err) {
    console.error(`Failed to pin summary for ticket #${ticketNumber}:`, err);
  }
}

async function sendOpeningTicketMessage(
  thread: Pick<ThreadChannel, 'send'>,
  creatorDisplayName: string,
  description: string,
  ticketNumber: number,
): Promise<void> {
  try {
    for (const content of buildTicketOpeningMessages(creatorDisplayName, description)) {
      // The opener echoes the user-controlled description into thread content;
      // suppress mention parsing so it can't ping @everyone or staff roles.
      await thread.send({ content, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error(`Failed to post opener for ticket #${ticketNumber}:`, err);
  }
}

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
