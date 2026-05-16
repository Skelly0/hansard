import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../client.js';
import { dispatchAutocomplete, dispatchSubcommand } from '../../utils/parentCommand.js';
import * as balance from './balance.js';
import * as check from './check.js';
import * as grant from './grant.js';
import * as grantBulk from './grantBulk.js';
import * as remove from './remove.js';
import * as spend from './spend.js';
import * as history from './history.js';
import * as leaderboard from './leaderboard.js';
import * as categories from './categories.js';
import * as categoryCreate from './categoryCreate.js';
import * as categoryEdit from './categoryEdit.js';
import * as categoryDelete from './categoryDelete.js';

const handlers = {
  balance,
  check,
  grant,
  'grant-bulk': grantBulk,
  remove,
  spend,
  history,
  leaderboard,
  categories,
  'category-create': categoryCreate,
  'category-edit': categoryEdit,
  'category-delete': categoryDelete,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour')
    .setDescription('Favour balances, transactions, and category management')
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('View your favour balances across all categories'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('Check another player\'s favour balances (staff only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player to inspect')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('grant')
        .setDescription('Grant favours to a player (staff only)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player to grant favours to').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Favour category name').setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Number of favours to grant').setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why the favours are being granted').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('grant-bulk')
        .setDescription('Grant favours to all members of a party or holders of an office (staff only)')
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Favour category name').setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Number of favours to grant each recipient').setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party name (mutually exclusive with office)').setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName('office').setDescription('Office name (mutually exclusive with party)').setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why the favours are being granted').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove favours from a player (staff only)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player to remove favours from').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Favour category name').setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Number of favours to remove').setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why the favours are being removed').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('spend')
        .setDescription('Deduct favours from a player (staff only)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player spending favours').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Favour category name').setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Number of favours to spend').setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('What the favours are being spent on').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View favour transaction history')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Player to view (staff only, defaults to yourself)').setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Filter by category').setRequired(false).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('Top favour holders (staff only) — overall, or per category')
        .addStringOption((opt) =>
          opt
            .setName('category')
            .setDescription('Restrict to one category (omit for overall ranking)')
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('categories')
        .setDescription('List all favour categories with descriptions'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('category-create')
        .setDescription('Create a new favour category / Group of Interest (staff only)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Display name (e.g. "Military Establishment")').setRequired(true).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('Short name shown in tags (e.g. "Military")').setRequired(false).setMaxLength(32),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('What this group represents').setRequired(false).setMaxLength(2000),
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('Emoji used in embeds (single character or :name:)').setRequired(false).setMaxLength(8),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('Hex colour for UI (e.g. #b94a48)').setRequired(false).setMaxLength(7),
        )
        .addStringOption((opt) =>
          opt.setName('spendable-on').setDescription('Comma-separated list (e.g. "military appointments, intelligence")').setRequired(false).setMaxLength(512),
        )
        .addIntegerOption((opt) =>
          opt.setName('sort-order').setDescription('Display order (lower = first)').setRequired(false).setMinValue(0),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('category-edit')
        .setDescription('Edit an existing favour category (staff only)')
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Category to edit (name match)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('New short name (use "-" to clear)').setRequired(false).setMaxLength(32),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('New description (use "-" to clear)').setRequired(false).setMaxLength(2000),
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('New emoji (use "-" to clear)').setRequired(false).setMaxLength(8),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
        )
        .addStringOption((opt) =>
          opt.setName('spendable-on').setDescription('Comma-separated list (use "-" to clear)').setRequired(false).setMaxLength(512),
        )
        .addIntegerOption((opt) =>
          opt.setName('sort-order').setDescription('New sort order').setRequired(false).setMinValue(0),
        )
        .addBooleanOption((opt) =>
          opt.setName('active').setDescription('Set active state').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('category-delete')
        .setDescription('Deactivate a favour category (staff only — soft delete, balances preserved)')
        .addStringOption((opt) =>
          opt.setName('category').setDescription('Category to deactivate (name match)').setRequired(true),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, handlers);
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await dispatchAutocomplete(interaction, handlers);
  },
};

export default command;
