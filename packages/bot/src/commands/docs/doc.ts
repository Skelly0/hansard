import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../client.js';
import { dispatchSubcommand } from '../../utils/parentCommand.js';
import * as view from './view.js';
import * as list from './list.js';
import * as search from './search.js';
import * as create from './create.js';
import * as edit from './edit.js';
import * as restore from './restore.js';

const handlers = {
  view,
  list,
  search,
  create,
  edit,
  restore,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doc')
    .setDescription('Document management — view, list, search, create, edit, restore')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a document')
        .addStringOption((opt) =>
          opt
            .setName('slug')
            .setDescription('The document slug (e.g. "constitution")')
            .setRequired(true)
            .setMaxLength(256),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Browse documents by collection')
        .addStringOption((opt) =>
          opt
            .setName('collection')
            .setDescription('Filter by collection name (optional)')
            .setRequired(false)
            .setMaxLength(128),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search across non-legislative documents')
        .addStringOption((opt) =>
          opt
            .setName('query')
            .setDescription('Search term (searches title and content)')
            .setRequired(true)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new document (staff only)')
        .addStringOption((opt) =>
          opt.setName('title').setDescription('Document title').setRequired(true).setMaxLength(256),
        )
        .addStringOption((opt) =>
          opt.setName('collection').setDescription('Collection name').setRequired(true).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('content').setDescription('Document content (markdown)').setRequired(false).setMaxLength(4000),
        )
        .addStringOption((opt) =>
          opt.setName('google-doc-url').setDescription('Google Doc URL (alternative to content)').setRequired(false).setMaxLength(512),
        )
        .addStringOption((opt) =>
          opt.setName('slug').setDescription('Custom slug (auto-generated if omitted)').setRequired(false).setMaxLength(200),
        )
        .addStringOption((opt) =>
          opt.setName('access-level').setDescription('Access level').setRequired(false).addChoices(
            { name: 'public', value: 'public' },
            { name: 'staff', value: 'staff' },
            { name: 'restricted', value: 'restricted' },
          ),
        )
        .addStringOption((opt) =>
          opt.setName('tags').setDescription('Comma-separated tags').setRequired(false).setMaxLength(256),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit a document by slug — bumps version (staff only)')
        .addStringOption((opt) =>
          opt.setName('slug').setDescription('Document slug').setRequired(true).setMaxLength(256),
        )
        .addStringOption((opt) =>
          opt.setName('content').setDescription('New document content').setRequired(true).setMaxLength(4000),
        )
        .addStringOption((opt) =>
          opt.setName('change-description').setDescription('What changed and why').setRequired(false).setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Restore a document to a previous version (staff only)')
        .addStringOption((opt) =>
          opt.setName('slug').setDescription('Document slug').setRequired(true).setMaxLength(256),
        )
        .addIntegerOption((opt) =>
          opt.setName('to-version').setDescription('Version number to restore').setRequired(true).setMinValue(1),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, handlers);
  },
};

export default command;
