import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
} from 'discord.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Partials are required for reaction events on messages cached before
  // the bot started — without these, MessageReactionAdd silently drops
  // events for older vote embeds.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

export const commands = new Collection<string, Command>();
