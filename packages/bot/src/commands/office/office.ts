import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../client.js';
import { dispatchAutocomplete, dispatchSubcommand } from '../../utils/parentCommand.js';
import * as create from './create.js';
import * as list from './list.js';
import * as info from './info.js';
import * as edit from './edit.js';
import * as appoint from './appoint.js';
import * as dismiss from './dismiss.js';

const handlers = {
  create,
  list,
  info,
  edit,
  appoint,
  dismiss,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('office')
    .setDescription('Office management — appoint, dismiss, view, edit')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new office (staff only)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Display name, e.g. "Chancellor"')
            .setRequired(true)
            .setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Where this office sits in the hierarchy')
            .setRequired(true)
            .addChoices(...create.TIER_CHOICES),
        )
        .addStringOption((opt) =>
          opt
            .setName('permissions')
            .setDescription('Comma-separated permissions, e.g. "legislative_leader,call_elections"')
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max-holders')
            .setDescription('How many people can hold this office at once (default 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(500),
        )
        .addStringOption((opt) =>
          opt
            .setName('filled-by')
            .setDescription('How the office is filled (default: elected)')
            .setRequired(false)
            .addChoices(...create.FILLED_BY_CHOICES),
        )
        .addRoleOption((opt) =>
          opt
            .setName('discord-role')
            .setDescription('Discord role to grant holders of this office')
            .setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt
            .setName('requires-confirmation')
            .setDescription('Require NPC house confirmation before taking effect')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Show all offices and their current holders'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Details on an office — permissions, how filled, holder history')
        .addStringOption((opt) =>
          opt
            .setName('office')
            .setDescription('Name of the office')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit a single field on an office (staff only)')
        .addStringOption((opt) =>
          opt
            .setName('office')
            .setDescription('Name of the office to edit')
            .setRequired(true)
            .setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt
            .setName('field')
            .setDescription('Which field to update')
            .setRequired(true)
            .addChoices(...edit.FIELD_CHOICES),
        )
        .addStringOption((opt) =>
          opt
            .setName('value')
            .setDescription('New value (parsed per-field — see /office info for current settings)')
            .setRequired(true)
            .setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('appoint')
        .setDescription('Appoint a player to an office (PM power or staff)')
        .addStringOption((opt) =>
          opt
            .setName('office')
            .setDescription('Name of the office')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The player to appoint')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dismiss')
        .setDescription('Remove the current holder from an office (PM power or staff)')
        .addStringOption((opt) =>
          opt
            .setName('office')
            .setDescription('Name of the office')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason for dismissal')
            .setRequired(false),
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
