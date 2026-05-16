import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../client.js';
import { dispatchAutocomplete, dispatchSubcommand } from '../../utils/parentCommand.js';
import { autocompleteParty } from './_partyAutocomplete.js';
import * as join from './join.js';
import * as leave from './leave.js';
import * as assign from './assign.js';
import * as list from './list.js';
import * as info from './info.js';
import * as create from './create.js';
import * as edit from './edit.js';
import * as dissolve from './dissolve.js';

const handlers = {
  join: { ...join, autocomplete: autocompleteParty },
  leave,
  assign: { ...assign, autocomplete: autocompleteParty },
  list,
  info,
  create,
  edit,
  dissolve,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Political party management')
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Join a political party')
        .addStringOption((opt) =>
          opt
            .setName('party')
            .setDescription('The party name to join')
            .setRequired(true)
            .setMaxLength(128)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Leave your current party and become independent'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign another character to a party (staff only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The character owner to assign')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('party')
            .setDescription('The party to assign')
            .setRequired(true)
            .setMaxLength(128)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List all active parties with member counts and colours'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Show party details — leader, members, faction, ideology')
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party (name or short tag)').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new political party (staff only)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Full party name').setRequired(true).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('Short tag (e.g. "LDP")').setRequired(false).setMaxLength(16),
        )
        .addStringOption((opt) =>
          opt.setName('ideology').setDescription('Brief ideology summary').setRequired(false).setMaxLength(256),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('Hex colour, e.g. #b94a48').setRequired(false).setMaxLength(7),
        )
        .addStringOption((opt) =>
          opt.setName('faction-id').setDescription('Optional faction UUID this party belongs to').setRequired(false),
        )
        .addRoleOption((opt) =>
          opt.setName('discord-role').setDescription('Discord role to map to this party').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('invite-only').setDescription('Require staff assignment instead of public self-join').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit an existing party (staff only)')
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party to edit (name match)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('name').setDescription('New full name').setRequired(false).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('New short tag (use "-" to clear)').setRequired(false).setMaxLength(16),
        )
        .addStringOption((opt) =>
          opt.setName('ideology').setDescription('New ideology (use "-" to clear)').setRequired(false).setMaxLength(256),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
        )
        .addRoleOption((opt) =>
          opt.setName('discord-role').setDescription('New Discord role (omit + role-clear:true to remove)').setRequired(false),
        )
        .addUserOption((opt) =>
          opt.setName('leader').setDescription('Set the party leader to an active party member').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('leader-clear').setDescription('Clear the party leader').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('role-clear').setDescription('Clear the mapped Discord role').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('active').setDescription('Set active state').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('invite-only').setDescription('Require staff assignment instead of public self-join').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dissolve')
        .setDescription('Dissolve a party (staff only — soft delete; members will be unassigned)')
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party to dissolve (name match)').setRequired(true),
        )
        .addBooleanOption((opt) =>
          opt.setName('confirm').setDescription('Confirm the dissolution (required)').setRequired(true),
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
