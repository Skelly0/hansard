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

interface EmojiColour {
  emoji: string;
  rgb: readonly [number, number, number];
}

const PARTY_REACTION_EMOJI_PALETTE: readonly EmojiColour[] = [
  { emoji: '🔴', rgb: [237, 66, 69] },
  { emoji: '🟥', rgb: [237, 66, 69] },
  { emoji: '❤️', rgb: [237, 66, 69] },
  { emoji: '🟠', rgb: [249, 115, 22] },
  { emoji: '🟧', rgb: [249, 115, 22] },
  { emoji: '🟡', rgb: [254, 231, 92] },
  { emoji: '🟨', rgb: [254, 231, 92] },
  { emoji: '💛', rgb: [254, 231, 92] },
  { emoji: '🟢', rgb: [87, 242, 135] },
  { emoji: '🟩', rgb: [87, 242, 135] },
  { emoji: '💚', rgb: [87, 242, 135] },
  { emoji: '🔵', rgb: [52, 152, 219] },
  { emoji: '🟦', rgb: [52, 152, 219] },
  { emoji: '💙', rgb: [52, 152, 219] },
  { emoji: '🟣', rgb: [155, 89, 182] },
  { emoji: '🟪', rgb: [155, 89, 182] },
  { emoji: '💜', rgb: [155, 89, 182] },
  { emoji: '🟤', rgb: [139, 69, 19] },
  { emoji: '🟫', rgb: [139, 69, 19] },
  { emoji: '🤎', rgb: [139, 69, 19] },
  { emoji: '⚫', rgb: [47, 49, 54] },
  { emoji: '⬛', rgb: [47, 49, 54] },
  { emoji: '🖤', rgb: [47, 49, 54] },
  { emoji: '⚪', rgb: [255, 255, 255] },
  { emoji: '⬜', rgb: [255, 255, 255] },
  { emoji: '🤍', rgb: [255, 255, 255] },
];

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

function colourDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return ((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2);
}

export function assignPartyReactionOptions(
  partiesToAssign: PartyJoinRow[],
  existingEmojiByPartyName: ReadonlyMap<string, string> = new Map(),
): PartyReactionOption[] {
  const used = new Set<string>();
  const reserved = new Map<string, string>();

  for (const party of partiesToAssign) {
    const existingEmoji = existingEmojiByPartyName.get(party.name);
    if (existingEmoji && !used.has(existingEmoji)) {
      reserved.set(party.name, existingEmoji);
      used.add(existingEmoji);
    }
  }

  return partiesToAssign.map((party) => {
    const existingEmoji = reserved.get(party.name);
    if (existingEmoji) {
      return { emoji: existingEmoji, party };
    }

    const rgb = parseHexColour(party.colour) ?? [255, 255, 255];
    const nearest = PARTY_REACTION_EMOJI_PALETTE
      .filter((candidate) => !used.has(candidate.emoji))
      .sort((a, b) => colourDistance(rgb, a.rgb) - colourDistance(rgb, b.rgb))[0];
    const fallback = FALLBACK_EMOJIS.find((emoji) => !used.has(emoji));
    const emoji = nearest?.emoji ?? fallback ?? '▫️';
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

  for (const emoji of payload.reactionEmojis) {
    try {
      await posted.react(emoji);
    } catch (error) {
      console.warn(`[party-join] failed to seed ${emoji} on ${posted.id}:`, error);
    }
  }

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

  for (const emoji of payload.reactionEmojis) {
    try {
      await edited.react(emoji);
    } catch (error) {
      console.warn(`[party-join] failed to seed ${emoji} on ${edited.id}:`, error);
    }
  }

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
