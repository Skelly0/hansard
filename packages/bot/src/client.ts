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
    // Required for the /phone DM relay. Without this, messageCreate never fires
    // for DMs, so dialed-call audio cannot be forwarded between players.
    GatewayIntentBits.DirectMessages,
  ],
  // Partials are required for reaction events on messages cached before
  // the bot started — without these, MessageReactionAdd silently drops
  // events for older vote embeds. The same partials cover DM messages
  // whose channels were not in cache at startup.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

export const commands = new Collection<string, Command>();
