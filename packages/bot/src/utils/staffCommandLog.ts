import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { isStaff } from './permissions.js';
import { hasStaffActionLogBeenPosted, postStaffActionLog } from './modLog.js';
import type { System } from './embeds.js';

const STAFF_ACTION_REPLY_LOGGING_INSTALLED = Symbol('staffActionReplyLoggingInstalled');
const ERROR_TITLE_PREFIX = '❌ Error';
const MAX_DETAILS_LINES = 12;
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_STRING_VALUE_LENGTH = 160;

const ALWAYS_REDACTED_OPTION_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'body',
  'discordtoken',
  'password',
  'secret',
  'token',
]);

const REDACTED_OPTION_NAMES_BY_COMMAND: Record<string, Set<string>> = {
  'doc create': new Set(['content']),
  'doc edit': new Set(['content']),
};

const STAFF_ACTION_COMMANDS = new Set([
  'bill amend-effects',
  'bill edit',
  'bill enact',
  'bill npc-vote',
  'bill recache',
  'bill repeal',
  'bill reraise',
  'bill submit-for',
  'doc create',
  'doc edit',
  'doc restore',
  'faction create',
  'faction dissolve',
  'faction edit',
  'phone admin force-end',
  'phone admin tap-create',
  'phone admin tap-revoke',
  'ticket assign',
  'ticket category-create',
  'ticket close',
  'ticket link',
  'ticket note',
  'ticket priority',
  'ticket reopen',
  'vote cancel',
  'vote certify',
  'vote close',
  'vote create',
  'vote elect',
  'vote npc-confirm',
  'vote open',
  'vote runoff',
  'vote schedule',
  'vote tally',
]);

const SYSTEM_BY_COMMAND: Record<string, System> = {
  bill: 'bills',
  doc: 'moderation',
  faction: 'players',
  phone: 'moderation',
  ticket: 'tickets',
  vote: 'voting',
};

type MentionLike = {
  id?: string;
  toString?: () => string;
};

type AttachmentLike = {
  id?: string;
  name?: string;
};

type CommandOptionLike = {
  name?: unknown;
  type?: unknown;
  value?: unknown;
  options?: readonly CommandOptionLike[];
  user?: MentionLike | null;
  channel?: MentionLike | null;
  role?: MentionLike | null;
  attachment?: AttachmentLike | null;
};

export async function postGenericStaffCommandActionLog(
  interaction: ChatInputCommandInteraction,
  replyOptions?: unknown,
): Promise<void> {
  if (hasStaffActionLogBeenPosted(interaction)) return;

  const commandPath = getCommandPath(interaction);
  if (!STAFF_ACTION_COMMANDS.has(commandPath)) return;
  if (!(await interactionMemberIsStaff(interaction))) return;

  await postStaffActionLog(interaction, {
    title: 'Staff Command Used',
    system: SYSTEM_BY_COMMAND[interaction.commandName] ?? 'moderation',
    fields: [
      { name: 'Command', value: `/${commandPath}`, inline: true },
      ...commandDetailsFields(interaction, commandPath),
      ...ticketResultFields(commandPath, replyOptions),
    ],
  });
}

export function installStaffActionReplyLogging(interaction: ChatInputCommandInteraction): void {
  const mutable = interaction as unknown as Record<PropertyKey, unknown>;
  if (mutable[STAFF_ACTION_REPLY_LOGGING_INSTALLED]) return;
  mutable[STAFF_ACTION_REPLY_LOGGING_INSTALLED] = true;

  wrapReplyMethod(interaction, 'reply');
  wrapReplyMethod(interaction, 'editReply');
  wrapReplyMethod(interaction, 'followUp');
}

function wrapReplyMethod(
  interaction: ChatInputCommandInteraction,
  methodName: 'reply' | 'editReply' | 'followUp',
): void {
  const mutable = interaction as unknown as Record<string, unknown>;
  const original = mutable[methodName];
  if (typeof original !== 'function') return;

  mutable[methodName] = async (...args: unknown[]) => {
    if (isSuccessfulStaffActionReply(args[0])) {
      await postGenericStaffCommandActionLog(interaction, args[0]);
    }

    return Reflect.apply(original, interaction, args);
  };
}

function getCommandPath(interaction: ChatInputCommandInteraction): string {
  const parts = [interaction.commandName];
  const group = safeGetSubcommandGroup(interaction);
  const subcommand = safeGetSubcommand(interaction);

  if (group) parts.push(group);
  if (subcommand) parts.push(subcommand);

  return parts.join(' ');
}

function commandDetailsFields(
  interaction: ChatInputCommandInteraction,
  commandPath: string,
) {
  const details = summarizeCommandOptions(interaction, commandPath);
  return details ? [{ name: 'Details', value: details }] : [];
}

function summarizeCommandOptions(
  interaction: ChatInputCommandInteraction,
  commandPath: string,
): string | undefined {
  const optionData = (interaction.options as { data?: readonly CommandOptionLike[] }).data;
  if (!Array.isArray(optionData) || optionData.length === 0) return undefined;

  const options = collectLeafOptions(optionData);
  if (options.length === 0) return undefined;

  const visibleOptions = options.slice(0, MAX_DETAILS_LINES);
  const lines = visibleOptions.map((option) => {
    const name = typeof option.name === 'string' ? option.name : 'option';
    return `\`${escapeBackticks(name)}\`: ${formatOptionValue(option, commandPath)}`;
  });

  const omittedCount = options.length - visibleOptions.length;
  if (omittedCount > 0) {
    lines.push(`...(+${omittedCount} more)`);
  }

  return truncateField(lines.join('\n'));
}

function ticketResultFields(commandPath: string, replyOptions: unknown) {
  if (!commandPath.startsWith('ticket ')) return [];

  const embed = extractEmbeds(replyOptions).find((candidate) => !isErrorEmbed(candidate));
  const description = embedDescription(embed);
  if (typeof description !== 'string' || description.trim().length === 0) return [];

  return [{ name: 'Result', value: truncateField(description) }];
}

function collectLeafOptions(options: readonly CommandOptionLike[]): CommandOptionLike[] {
  const leaves: CommandOptionLike[] = [];

  for (const option of options) {
    if (isNestedCommandOption(option)) {
      leaves.push(...collectLeafOptions(option.options ?? []));
      continue;
    }

    leaves.push(option);
  }

  return leaves;
}

function isNestedCommandOption(option: CommandOptionLike): boolean {
  return option.type === ApplicationCommandOptionType.Subcommand
    || option.type === ApplicationCommandOptionType.SubcommandGroup;
}

function formatOptionValue(option: CommandOptionLike, commandPath: string): string {
  const name = typeof option.name === 'string' ? option.name : '';
  if (shouldRedactOption(commandPath, name)) return '[redacted]';

  const mention = formatMentionValue(option);
  if (mention) return mention;

  if (option.attachment) {
    return option.attachment.name
      ? JSON.stringify(truncateString(option.attachment.name))
      : code(String(option.attachment.id ?? 'attachment'));
  }

  const value = option.value;
  if (value === null) return 'null';
  if (value === undefined) return '[set]';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(truncateString(value));
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return `[${typeof value}]`;
  }
}

function formatMentionValue(option: CommandOptionLike): string | undefined {
  const explicitMention = mentionToString(option.user)
    ?? mentionToString(option.channel)
    ?? mentionToString(option.role);
  if (explicitMention) return explicitMention;

  if (typeof option.value !== 'string') return undefined;

  switch (option.type) {
    case ApplicationCommandOptionType.User:
      return `<@${option.value}>`;
    case ApplicationCommandOptionType.Channel:
      return `<#${option.value}>`;
    case ApplicationCommandOptionType.Role:
      return `<@&${option.value}>`;
    default:
      return undefined;
  }
}

function mentionToString(value: MentionLike | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value.toString === 'function') {
    const rendered = value.toString();
    if (rendered && rendered !== '[object Object]') return rendered;
  }

  return value.id ? code(value.id) : undefined;
}

function shouldRedactOption(commandPath: string, name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_\s]/g, '');
  return ALWAYS_REDACTED_OPTION_NAMES.has(normalized)
    || REDACTED_OPTION_NAMES_BY_COMMAND[commandPath]?.has(normalized) === true;
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_VALUE_LENGTH - 3)}...`;
}

function truncateField(value: string): string {
  if (value.length <= MAX_FIELD_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_FIELD_VALUE_LENGTH - 3)}...`;
}

function code(value: string): string {
  return `\`${escapeBackticks(value)}\``;
}

function escapeBackticks(value: string): string {
  return value.replace(/`/g, "'");
}

async function interactionMemberIsStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const member = interaction.member;
  if (!member || !('roles' in member)) return false;

  return isStaff(member);
}

function safeGetSubcommand(interaction: ChatInputCommandInteraction): string | null {
  try {
    return interaction.options.getSubcommand(false);
  } catch {
    return null;
  }
}

function safeGetSubcommandGroup(interaction: ChatInputCommandInteraction): string | null {
  try {
    return interaction.options.getSubcommandGroup(false);
  } catch {
    return null;
  }
}

function isSuccessfulStaffActionReply(options: unknown): boolean {
  const embeds = extractEmbeds(options);
  if (embeds.length === 0) return false;

  return embeds.some((embed) => !isErrorEmbed(embed));
}

function extractEmbeds(options: unknown): unknown[] {
  if (!options || typeof options !== 'object') return [];
  const embeds = (options as { embeds?: unknown }).embeds;
  return Array.isArray(embeds) ? embeds : [];
}

function isErrorEmbed(embed: unknown): boolean {
  const title = embedTitle(embed);
  return typeof title === 'string' && title.startsWith(ERROR_TITLE_PREFIX);
}

function embedTitle(embed: unknown): unknown {
  if (!embed || typeof embed !== 'object') return undefined;

  const withData = embed as { data?: { title?: unknown } };
  if (withData.data?.title !== undefined) return withData.data.title;

  const withJson = embed as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') {
    try {
      const json = withJson.toJSON();
      return json && typeof json === 'object'
        ? (json as { title?: unknown }).title
        : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function embedDescription(embed: unknown): unknown {
  if (!embed || typeof embed !== 'object') return undefined;

  const withData = embed as { data?: { description?: unknown } };
  if (withData.data?.description !== undefined) return withData.data.description;

  const withJson = embed as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') {
    try {
      const json = withJson.toJSON();
      return json && typeof json === 'object'
        ? (json as { description?: unknown }).description
        : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
