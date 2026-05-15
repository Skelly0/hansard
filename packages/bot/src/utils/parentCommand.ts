import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { errorEmbed } from './embeds.js';

export type SubcommandHandler = {
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
};

export type SubcommandMap = Record<string, SubcommandHandler>;

export type GroupedSubcommandMap = Record<string, SubcommandMap>;

export function dispatchSubcommand(
  interaction: ChatInputCommandInteraction,
  handlers: SubcommandMap,
  groups: GroupedSubcommandMap = {},
): Promise<void> {
  // Real Discord interactions always expose getSubcommandGroup; older test
  // doubles may not, so fall back to no-group rather than crashing.
  const group = typeof interaction.options.getSubcommandGroup === 'function'
    ? interaction.options.getSubcommandGroup(false)
    : null;
  const sub = interaction.options.getSubcommand();

  if (group) {
    const handler = groups[group]?.[sub];
    if (!handler) {
      return interaction.reply({
        embeds: [errorEmbed(`Unknown subcommand: \`/${interaction.commandName} ${group} ${sub}\``)],
        ephemeral: true,
      }).then(() => undefined);
    }
    return handler.execute(interaction);
  }

  const handler = handlers[sub];
  if (!handler) {
    return interaction.reply({
      embeds: [errorEmbed(`Unknown subcommand: \`/${interaction.commandName} ${sub}\``)],
      ephemeral: true,
    }).then(() => undefined);
  }
  return handler.execute(interaction);
}

export function dispatchAutocomplete(
  interaction: AutocompleteInteraction,
  handlers: SubcommandMap,
  groups: GroupedSubcommandMap = {},
): Promise<void> {
  const group = typeof interaction.options.getSubcommandGroup === 'function'
    ? interaction.options.getSubcommandGroup(false)
    : null;
  const sub = interaction.options.getSubcommand();
  const handler = group ? groups[group]?.[sub] : handlers[sub];
  if (!handler?.autocomplete) {
    return interaction.respond([]);
  }
  return handler.autocomplete(interaction);
}
