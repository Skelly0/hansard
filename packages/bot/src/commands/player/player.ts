import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../client.js';
import { dispatchSubcommand } from '../../utils/parentCommand.js';
import { TYPE_CHOICES as EVENT_TYPE_CHOICES } from './events.js';
import * as events from './events.js';
import * as health from './health.js';
import * as history from './history.js';
import * as roster from './roster.js';
import * as whois from './whois.js';
import {
  executeCharacterLookup,
  executeCharacterCreate,
  executeChangeParty,
  ADMIN_MIN_AGE,
  ADMIN_MAX_AGE,
} from './admin.js';

const handlers = {
  roster,
  whois,
  history,
  events,
  health,
};

const adminHandlers = {
  'character-lookup': { execute: executeCharacterLookup },
  'character-create': { execute: executeCharacterCreate },
  'change-party': { execute: executeChangeParty },
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Player rosters, dossiers, history, health, and staff administration')
    .addSubcommand((sub) =>
      sub
        .setName('roster')
        .setDescription('List active players, optionally filtered by faction or party')
        .addStringOption((opt) =>
          opt
            .setName('faction')
            .setDescription('Filter by faction name (case-insensitive)')
            .setRequired(false)
            .setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt
            .setName('party')
            .setDescription('Filter by party name (case-insensitive)')
            .setRequired(false)
            .setMaxLength(128),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('whois')
        .setDescription('Reverse-lookup a player by their in-character name')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('The character name to search for')
            .setRequired(true)
            .setMaxLength(128),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View a player\'s event log')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player to view history for (defaults to yourself)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('events')
        .setDescription('Show recent events from a player\'s log')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player to look up')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Filter by event type (optional)')
            .setRequired(false)
            .addChoices(...EVENT_TYPE_CHOICES),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('health')
        .setDescription('Show a player\'s health and ailment status')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player to inspect')
            .setRequired(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Staff player administration')
        .addSubcommand((sub) =>
          sub
            .setName('character-lookup')
            .setDescription('Look up the Discord account behind a character name (staff only)')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Character name to search').setRequired(true).setMaxLength(128),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('character-create')
            .setDescription('Create a character on behalf of another user (staff only)')
            .addUserOption((opt) =>
              opt.setName('user').setDescription('The user to create a character for').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('character-name').setDescription('Character name').setRequired(true).setMaxLength(128),
            )
            .addIntegerOption((opt) =>
              opt
                .setName('starting-age')
                .setDescription(`Starting age (${ADMIN_MIN_AGE}-${ADMIN_MAX_AGE})`)
                .setRequired(true)
                .setMinValue(ADMIN_MIN_AGE)
                .setMaxValue(ADMIN_MAX_AGE),
            )
            .addStringOption((opt) =>
              opt.setName('faction').setDescription('Faction name').setRequired(false).setMaxLength(128),
            )
            .addStringOption((opt) =>
              opt.setName('party').setDescription('Party name').setRequired(false).setMaxLength(128),
            )
            .addStringOption((opt) =>
              opt.setName('bio').setDescription('Character biography').setRequired(false).setMaxLength(2000),
            )
            .addStringOption((opt) =>
              opt.setName('portrait-url').setDescription('Portrait image URL').setRequired(false).setMaxLength(512),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('change-party')
            .setDescription('Change another player\'s party (staff only)')
            .addUserOption((opt) =>
              opt.setName('user').setDescription('The player whose party to change').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('party').setDescription('Party name (or "independent")').setRequired(true).setMaxLength(128),
            ),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await dispatchSubcommand(interaction, handlers, { admin: adminHandlers });
  },
};

export default command;
