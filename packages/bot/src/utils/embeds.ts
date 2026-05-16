import { EmbedBuilder } from 'discord.js';

/** System names that map to colour/emoji identities. */
export type System =
  | 'bills'
  | 'voting'
  | 'players'
  | 'offices'
  | 'favours'
  | 'graveyard'
  | 'tickets'
  | 'moderation'
  | 'simulation';

/** Hex colours per system, drawn from the scaffold palette. */
const SYSTEM_COLOURS: Record<System, number> = {
  bills:       0xC4873B,
  voting:      0x6A9BCC,
  players:     0x788C5D,
  offices:     0x9B7CB8,
  favours:     0xC4873B,
  graveyard:   0x9C9890,
  tickets:     0x7B8BA8,
  moderation:  0xC25B4E,
  simulation:  0x5D8C7B,
};

/** Emoji prefix per system. */
const SYSTEM_EMOJIS: Record<System, string> = {
  tickets:     '\uD83D\uDCCB', // 📋
  bills:       '\uD83D\uDCDC', // 📜
  voting:      '\uD83D\uDDF3\uFE0F', // 🗳️
  players:     '\uD83D\uDC64', // 👤
  offices:     '\uD83C\uDFDB\uFE0F', // 🏛️
  favours:     '\uD83E\uDD1D', // 🤝
  graveyard:   '\u26B0\uFE0F', // ⚰️
  simulation:  '\u23F3', // ⏳
  moderation:  '\uD83D\uDD28', // 🔨
};

/** Error colour — brick red from moderation. */
const ERROR_COLOUR = 0xC25B4E;

/** Success colour — sage green from players. */
const SUCCESS_COLOUR = 0x788C5D;

function getBotName(): string {
  return process.env.BOT_DISPLAY_NAME || 'Hansard';
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface CreateEmbedOptions {
  title: string;
  description?: string;
  system?: System;
  colour?: number;
  fields?: EmbedField[];
  thumbnail?: string;
  url?: string;
}

/**
 * Build a standardised embed with system colour, emoji prefix, and bot footer.
 */
export function createEmbed(options: CreateEmbedOptions): EmbedBuilder {
  const { title, description, system, colour, fields, thumbnail, url } = options;

  const resolvedColour = colour ?? (system ? SYSTEM_COLOURS[system] : 0xD97757);
  const emoji = system ? SYSTEM_EMOJIS[system] : undefined;
  const prefixedTitle = emoji ? `${emoji} ${title}` : title;

  const embed = new EmbedBuilder()
    .setTitle(prefixedTitle)
    .setColor(resolvedColour)
    .setFooter({ text: getBotName() })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  if (fields?.length) {
    embed.addFields(fields.map((f) => ({
      name: f.name,
      value: f.value,
      inline: f.inline ?? false,
    })));
  }

  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  if (url) {
    embed.setURL(url);
  }

  return embed;
}

/**
 * Build a red error embed.
 */
export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('\u274C Error')
    .setDescription(message)
    .setColor(ERROR_COLOUR)
    .setFooter({ text: getBotName() })
    .setTimestamp();
}

/**
 * Build a green success embed.
 */
export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`\u2705 ${title}`)
    .setColor(SUCCESS_COLOUR)
    .setFooter({ text: getBotName() })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}
