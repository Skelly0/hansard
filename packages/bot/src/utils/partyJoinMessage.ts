import {
  type Collection,
  type Client,
  type Message,
  type MessageReaction,
  type NewsChannel,
  type PartialMessageReaction,
  type PartialUser,
  type TextChannel,
  type ThreadChannel,
  type User,
} from 'discord.js';
import { and, asc, eq } from 'drizzle-orm';
import { parties, playerEventLog, players } from '@hansard/db';
import { db } from '../db.js';
import { createEmbed } from './embeds.js';

export const DEFAULT_PARTY_JOIN_CHANNEL_ID = '1501608247411609646';
export const PARTY_JOIN_EMBED_TITLE = '🏛️ Join a Party';

type ReactionInput = MessageReaction | PartialMessageReaction;
type UserInput = User | PartialUser;
type PartyJoinMessageChannel = TextChannel | NewsChannel | ThreadChannel;

export interface PartyJoinRow {
  id: string;
  name: string;
  shortName: string | null;
  ideology: string | null;
  colour: string | null;
  discordRoleId: string | null;
  isActive: boolean;
  isInviteOnly: boolean;
}

export interface PartyReactionOption {
  emoji: string;
  party: PartyJoinRow;
}

interface EmojiHueGroup {
  hue: number;
  emojis: readonly string[];
}

interface HslColour {
  hue: number;
  saturation: number;
  lightness: number;
}

const RED_EMOJIS = ['🔴', '🟥', '❤️'] as const;
const ORANGE_EMOJIS = ['🟠', '🟧'] as const;
const YELLOW_EMOJIS = ['🟡', '🟨', '💛'] as const;
const GREEN_EMOJIS = ['🟢', '🟩', '💚'] as const;
const BLUE_EMOJIS = ['🔵', '🟦', '💙'] as const;
const PURPLE_EMOJIS = ['🟣', '🟪', '💜'] as const;
const BROWN_EMOJIS = ['🟤', '🟫', '🤎'] as const;
const BLACK_EMOJIS = ['⚫', '⬛', '🖤'] as const;
const WHITE_EMOJIS = ['⚪', '⬜', '🤍'] as const;

const CHROMATIC_PARTY_REACTION_EMOJI_GROUPS: readonly EmojiHueGroup[] = [
  { hue: 0, emojis: RED_EMOJIS },
  { hue: 30, emojis: ORANGE_EMOJIS },
  { hue: 58, emojis: YELLOW_EMOJIS },
  { hue: 130, emojis: GREEN_EMOJIS },
  { hue: 215, emojis: BLUE_EMOJIS },
  { hue: 280, emojis: PURPLE_EMOJIS },
];

const BROWN_PARTY_REACTION_EMOJI_GROUP: EmojiHueGroup = { hue: 28, emojis: BROWN_EMOJIS };
const NEUTRAL_PARTY_REACTION_EMOJIS = new Set<string>([...BLACK_EMOJIS, ...WHITE_EMOJIS]);

const FALLBACK_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const;
const partyJoinLocks = new Map<string, Promise<void>>();

function resolvePartyJoinChannelId(): string {
  return process.env.PARTY_JOIN_CHANNEL_ID || DEFAULT_PARTY_JOIN_CHANNEL_ID;
}

function resolvePartyJoinMessageId(): string | null {
  return process.env.PARTY_JOIN_MESSAGE_ID?.trim() || null;
}

function parseHexColour(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

function rgbToHsl(rgb: readonly [number, number, number]): HslColour {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
  let hue: number;

  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * (((b - r) / delta) + 2);
  } else {
    hue = 60 * (((r - g) / delta) + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation,
    lightness,
  };
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function hashString(input: string): number {
  let hash = 0;
  for (const char of input) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function rotateGroups<T>(groups: readonly T[], offset: number): T[] {
  if (groups.length === 0) return [];
  const normalizedOffset = offset % groups.length;
  return [
    ...groups.slice(normalizedOffset),
    ...groups.slice(0, normalizedOffset),
  ];
}

function flattenEmojiGroups(groups: readonly EmojiHueGroup[]): string[] {
  return groups.flatMap((group) => [...group.emojis]);
}

function orderedChromaticEmojiGroups(hsl: HslColour): EmojiHueGroup[] {
  const hueSortedGroups = [...CHROMATIC_PARTY_REACTION_EMOJI_GROUPS]
    .sort((a, b) => hueDistance(hsl.hue, a.hue) - hueDistance(hsl.hue, b.hue));

  const isBrownish = hsl.lightness <= 0.42 && hsl.hue >= 15 && hsl.hue <= 50;
  return isBrownish
    ? [BROWN_PARTY_REACTION_EMOJI_GROUP, ...hueSortedGroups]
    : [...hueSortedGroups, BROWN_PARTY_REACTION_EMOJI_GROUP];
}

function fallbackChromaticEmojisForParty(party: PartyJoinRow): string[] {
  const groups = [
    ...CHROMATIC_PARTY_REACTION_EMOJI_GROUPS,
    BROWN_PARTY_REACTION_EMOJI_GROUP,
  ];
  return flattenEmojiGroups(rotateGroups(groups, hashString(party.name) % groups.length));
}

function uniqueEmojis(emojis: readonly string[]): string[] {
  return [...new Set(emojis)];
}

function partyReactionEmojiCandidates(party: PartyJoinRow): string[] {
  const rgb = parseHexColour(party.colour);
  const fallbackChromaticEmojis = fallbackChromaticEmojisForParty(party);

  if (!rgb) {
    return uniqueEmojis([...fallbackChromaticEmojis, ...WHITE_EMOJIS, ...BLACK_EMOJIS]);
  }

  const hsl = rgbToHsl(rgb);

  if (hsl.saturation < 0.12) {
    if (hsl.lightness <= 0.08) {
      return uniqueEmojis(['⚫', ...fallbackChromaticEmojis, '⬛', '🖤', ...WHITE_EMOJIS]);
    }

    if (hsl.lightness >= 0.92) {
      return uniqueEmojis(['⚪', ...fallbackChromaticEmojis, '⬜', '🤍', ...BLACK_EMOJIS]);
    }

    return uniqueEmojis([...fallbackChromaticEmojis, ...WHITE_EMOJIS, ...BLACK_EMOJIS]);
  }

  return uniqueEmojis([
    ...flattenEmojiGroups(orderedChromaticEmojiGroups(hsl)),
    ...WHITE_EMOJIS,
    ...BLACK_EMOJIS,
  ]);
}

function preferredNeutralEmojiForParty(party: PartyJoinRow): string | null {
  const rgb = parseHexColour(party.colour);
  if (!rgb) return null;

  const hsl = rgbToHsl(rgb);
  if (hsl.saturation >= 0.12) return null;
  if (hsl.lightness <= 0.08) return '⚫';
  if (hsl.lightness >= 0.92) return '⚪';
  return null;
}

function shouldKeepExistingPartyEmoji(party: PartyJoinRow, emoji: string): boolean {
  if (!NEUTRAL_PARTY_REACTION_EMOJIS.has(emoji)) {
    return true;
  }

  return preferredNeutralEmojiForParty(party) === emoji;
}

export function assignPartyReactionOptions(
  partiesToAssign: PartyJoinRow[],
  existingEmojiByPartyName: ReadonlyMap<string, string> = new Map(),
): PartyReactionOption[] {
  const used = new Set<string>();
  const reserved = new Map<string, string>();

  for (const party of partiesToAssign) {
    const existingEmoji = existingEmojiByPartyName.get(party.name);
    if (existingEmoji && !used.has(existingEmoji) && shouldKeepExistingPartyEmoji(party, existingEmoji)) {
      reserved.set(party.name, existingEmoji);
      used.add(existingEmoji);
    }
  }

  return partiesToAssign.map((party) => {
    const existingEmoji = reserved.get(party.name);
    if (existingEmoji) {
      return { emoji: existingEmoji, party };
    }

    const nearest = partyReactionEmojiCandidates(party).find((candidate) => !used.has(candidate));
    const fallback = FALLBACK_EMOJIS.find((emoji) => !used.has(emoji));
    const emoji = nearest ?? fallback ?? '▫️';
    used.add(emoji);
    return { emoji, party };
  });
}

export function buildPartyJoinMessagePayload(
  allParties: PartyJoinRow[],
  existingEmojiByPartyName: ReadonlyMap<string, string> = new Map(),
): {
  embeds: ReturnType<typeof createEmbed>[];
  options: PartyReactionOption[];
  reactionEmojis: string[];
} {
  const joinableParties = allParties.filter((party) => party.isActive && !party.isInviteOnly);
  const options = assignPartyReactionOptions(joinableParties, existingEmojiByPartyName);
  const lines = options.map(({ emoji, party }) => {
    const tag = party.shortName ? ` (${party.shortName})` : '';
    const ideology = party.ideology?.trim() || 'Unlisted';
    return `${emoji} **${party.name}**${tag} — Ideology: *${ideology}*`;
  });

  const embed = createEmbed({
    title: 'Join a Party',
    description: lines.length > 0
      ? [
          'React with the emoji for the open party you want to join.',
          'Invite-only parties are not listed.',
          '',
          ...lines,
        ].join('\n')
      : 'No open parties are currently available.',
    system: 'offices',
  });

  return {
    embeds: [embed],
    options,
    reactionEmojis: options.map((option) => option.emoji),
  };
}

async function notifyByDm(user: UserInput, message: string): Promise<void> {
  try {
    const fullUser = user.partial ? await user.fetch() : (user as User);
    await fullUser.send(message);
  } catch {
    // User has DMs closed.
  }
}

async function removeUserReaction(reaction: ReactionInput, user: UserInput): Promise<void> {
  try {
    await reaction.users.remove(user.id);
  } catch {
    // Missing permissions or uncached reaction; the join itself can still succeed.
  }
}

function isPartyJoinMessage(message: Message | PartialMessageReaction['message']): boolean {
  const title = message.embeds?.[0]?.title;
  return title === PARTY_JOIN_EMBED_TITLE;
}

function isBotAuthored(message: Message | PartialMessageReaction['message']): boolean {
  return Boolean(message.author?.id && message.client.user?.id && message.author.id === message.client.user.id);
}

function valuesFromFetchedMessages(
  fetched: Collection<string, Message> | Map<string, Message> | Message[],
): Message[] {
  return Array.isArray(fetched) ? fetched : [...fetched.values()];
}

async function findNewestPartyJoinMessage(channel: PartyJoinMessageChannel): Promise<Message | null> {
  const fetched = await channel.messages.fetch({ limit: 100 });
  return valuesFromFetchedMessages(fetched as Collection<string, Message>)
    .filter((candidate) => isPartyJoinMessage(candidate) && isBotAuthored(candidate))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null;
}

async function findRefreshablePartyJoinMessage(channel: PartyJoinMessageChannel): Promise<Message | null> {
  const configuredMessageId = resolvePartyJoinMessageId();
  if (configuredMessageId) {
    try {
      const message = await channel.messages.fetch(configuredMessageId);
      return isPartyJoinMessage(message) && isBotAuthored(message) ? message : null;
    } catch (error) {
      console.warn(`[party-join] failed to fetch configured join board ${configuredMessageId}:`, error);
      return null;
    }
  }

  try {
    return await findNewestPartyJoinMessage(channel);
  } catch (error) {
    console.warn('[party-join] failed to find current join board:', error);
    return null;
  }
}

async function isCurrentPartyJoinMessage(message: Message | PartialMessageReaction['message']): Promise<boolean> {
  if (message.channelId !== resolvePartyJoinChannelId()) return false;
  if (!isPartyJoinMessage(message)) return false;

  const configuredMessageId = resolvePartyJoinMessageId();
  if (configuredMessageId) return message.id === configuredMessageId;

  if (!isBotAuthored(message)) return false;
  if (!('messages' in message.channel)) return false;

  try {
    const newestJoinBoard = await findNewestPartyJoinMessage(message.channel as PartyJoinMessageChannel);

    return newestJoinBoard?.id === message.id;
  } catch (error) {
    console.warn(`[party-join] failed to verify current join board ${message.id}:`, error);
    return false;
  }
}

function partyNameForReactionEmoji(
  message: Message | PartialMessageReaction['message'],
  emoji: string,
): string | null {
  const description = message.embeds?.[0]?.description;
  if (!description) return null;

  const line = description
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${emoji} `));
  if (!line) return null;

  return line.match(/\*\*(.+?)\*\*/)?.[1] ?? null;
}

function partyEmojiAssignmentsFromMessage(message: Message): Map<string, string> {
  const description = message.embeds?.[0]?.description;
  if (!description) return new Map();

  return description
    .split('\n')
    .reduce((assignments, line) => {
      const match = line.trimStart().match(/^(\S+)\s+\*\*(.+?)\*\*/);
      if (match) assignments.set(match[2], match[1]);
      return assignments;
    }, new Map<string, string>());
}

async function fetchJoinableParties(): Promise<PartyJoinRow[]> {
  return db
    .select({
      id: parties.id,
      name: parties.name,
      shortName: parties.shortName,
      ideology: parties.ideology,
      colour: parties.colour,
      discordRoleId: parties.discordRoleId,
      isActive: parties.isActive,
      isInviteOnly: parties.isInviteOnly,
    })
    .from(parties)
    .where(and(eq(parties.isActive, true), eq(parties.isInviteOnly, false)))
    .orderBy(asc(parties.name));
}

async function withPartyJoinLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = partyJoinLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = previous
    .catch(() => undefined)
    .then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

  partyJoinLocks.set(userId, current);
  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (partyJoinLocks.get(userId) === current) {
      partyJoinLocks.delete(userId);
    }
  }
}

async function clearPartyLeaderIfMatches(
  tx: Pick<typeof db, 'update'>,
  partyId: string | null,
  playerId: string,
): Promise<void> {
  if (!partyId) return;

  await tx
    .update(parties)
    .set({ leaderId: null })
    .where(and(
      eq(parties.id, partyId),
      eq(parties.leaderId, playerId),
    ));
}

async function seedPartyJoinReactions(message: Message, reactionEmojis: readonly string[]): Promise<void> {
  for (const emoji of reactionEmojis) {
    try {
      await message.react(emoji);
    } catch (error) {
      console.warn(`[party-join] failed to seed ${emoji} on ${message.id}:`, error);
    }
  }
}

async function removeStaleBotReactions(message: Message, reactionEmojis: readonly string[]): Promise<void> {
  const botId = message.client.user?.id;
  if (!botId) return;

  const expectedEmojis = new Set(reactionEmojis);
  for (const reaction of message.reactions.cache.values()) {
    const emoji = reaction.emoji.name;
    if (!emoji || expectedEmojis.has(emoji)) continue;

    try {
      await reaction.users.remove(botId);
    } catch (error) {
      console.warn(`[party-join] failed to remove stale ${emoji} reaction on ${message.id}:`, error);
    }
  }
}

async function resetPartyJoinReactions(message: Message, reactionEmojis: readonly string[]): Promise<void> {
  try {
    await message.reactions.removeAll();
  } catch (error) {
    console.warn(`[party-join] failed to clear reactions on ${message.id}; removing stale bot reactions instead:`, error);
    await removeStaleBotReactions(message, reactionEmojis);
  }

  await seedPartyJoinReactions(message, reactionEmojis);
}

export async function postPartyJoinMessage(
  client: Client,
  channelId = resolvePartyJoinChannelId(),
): Promise<Message> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a sendable text channel.`);
  }

  const payload = buildPartyJoinMessagePayload(await fetchJoinableParties());
  const posted = await (channel as TextChannel | NewsChannel | ThreadChannel).send({
    embeds: payload.embeds,
  });

  await seedPartyJoinReactions(posted, payload.reactionEmojis);

  return posted;
}

export async function refreshPartyJoinMessage(
  client: Client,
  channelId = resolvePartyJoinChannelId(),
): Promise<Message | null> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    return null;
  }

  const currentMessage = await findRefreshablePartyJoinMessage(channel as PartyJoinMessageChannel);
  if (!currentMessage) {
    return null;
  }

  const payload = buildPartyJoinMessagePayload(
    await fetchJoinableParties(),
    partyEmojiAssignmentsFromMessage(currentMessage),
  );
  const edited = await currentMessage.edit({ embeds: payload.embeds });

  await resetPartyJoinReactions(edited, payload.reactionEmojis);

  return edited;
}

export async function handlePartyJoinReaction(reaction: ReactionInput, user: UserInput): Promise<boolean> {
  const message = reaction.message;
  if (!(await isCurrentPartyJoinMessage(message))) return false;

  const emoji = reaction.emoji.name;
  if (!emoji) return true;

  const partyName = partyNameForReactionEmoji(message, emoji);

  if (!partyName) {
    await removeUserReaction(reaction, user);
    return true;
  }

  return withPartyJoinLock(user.id, async () => {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: parties.id,
          name: parties.name,
          shortName: parties.shortName,
          ideology: parties.ideology,
          colour: parties.colour,
          discordRoleId: parties.discordRoleId,
          isActive: parties.isActive,
          isInviteOnly: parties.isInviteOnly,
        })
        .from(parties)
        .where(and(
          eq(parties.name, partyName),
          eq(parties.isActive, true),
          eq(parties.isInviteOnly, false),
        ))
        .limit(1);

      if (!target) {
        return { status: 'unavailable' as const, partyName };
      }

      const [player] = await tx
        .select()
        .from(players)
        .where(eq(players.discordId, user.id))
        .limit(1);

      if (!player || !player.characterName) {
        return { status: 'no-character' as const, targetName: target.name };
      }

      if (player.isAlive === false) {
        return { status: 'dead' as const, targetName: target.name };
      }

      if (player.partyId === target.id) {
        return {
          status: 'already' as const,
          characterName: player.characterName,
          targetName: target.name,
        };
      }

      let oldPartyName = 'Independent';
      let oldPartyRoleId: string | null = null;
      if (player.partyId) {
        const [oldParty] = await tx
          .select({ name: parties.name, discordRoleId: parties.discordRoleId })
          .from(parties)
          .where(eq(parties.id, player.partyId))
          .limit(1);
        oldPartyName = oldParty?.name ?? 'Unknown';
        oldPartyRoleId = oldParty?.discordRoleId ?? null;
      }

      await tx
        .update(players)
        .set({
          partyId: target.id,
          lastActiveAt: new Date(),
        })
        .where(eq(players.id, player.id));

      await clearPartyLeaderIfMatches(tx, player.partyId, player.id);

      await tx.insert(playerEventLog).values({
        playerId: player.id,
        eventType: 'party_change',
        description: `${player.characterName} left ${oldPartyName} and joined ${target.name}.`,
        oldValue: { partyId: player.partyId, partyName: oldPartyName },
        newValue: { partyId: target.id, partyName: target.name },
        triggeredById: player.id,
      });

      return {
        status: 'joined' as const,
        playerId: player.id,
        characterName: player.characterName,
        targetName: target.name,
        oldPartyRoleId,
        newPartyRoleId: target.discordRoleId,
      };
    });

    await removeUserReaction(reaction, user);

    if (result.status === 'unavailable') {
      await notifyByDm(user, `**${result.partyName}** is no longer available for open reaction joins.`);
      return true;
    }

    if (result.status === 'no-character') {
      await notifyByDm(
        user,
        `You were not added to **${result.targetName}** because you have not created a character yet. Run \`/character create\` first.`,
      );
      return true;
    }

    if (result.status === 'dead') {
      await notifyByDm(user, `You were not added to **${result.targetName}** because dead characters cannot join parties.`);
      return true;
    }

    if (result.status === 'already') {
      await notifyByDm(user, `You are already a member of **${result.targetName}**.`);
      return true;
    }

    let roleSyncWarning = '';
    if (message.guild && (result.oldPartyRoleId || result.newPartyRoleId)) {
      try {
        const member = await message.guild.members.fetch(user.id);
        if (result.oldPartyRoleId) await member.roles.remove(result.oldPartyRoleId);
        if (result.newPartyRoleId) await member.roles.add(result.newPartyRoleId);
      } catch (error) {
        console.warn(`[party-join] failed to sync party roles for ${result.playerId}:`, error);
        roleSyncWarning = '\n\nDiscord role sync failed; ask staff to run `/sync-roles`.';
      }
    }

    await notifyByDm(
      user,
      `**${result.characterName}** joined **${result.targetName}**.${roleSyncWarning}`,
    );
    return true;
  });
}
