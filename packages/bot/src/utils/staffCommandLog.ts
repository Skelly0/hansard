import type { ChatInputCommandInteraction } from 'discord.js';
import { isStaff } from './permissions.js';
import { hasStaffActionLogBeenPosted, postStaffActionLog } from './modLog.js';
import type { System } from './embeds.js';

const STAFF_ACTION_REPLY_LOGGING_INSTALLED = Symbol('staffActionReplyLoggingInstalled');
const ERROR_TITLE_PREFIX = '❌ Error';

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

export async function postGenericStaffCommandActionLog(
  interaction: ChatInputCommandInteraction,
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
      await postGenericStaffCommandActionLog(interaction);
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
