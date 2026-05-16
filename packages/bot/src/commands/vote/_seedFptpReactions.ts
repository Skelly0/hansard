import type { Client, TextChannel, NewsChannel, ThreadChannel, Message } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { candidates } from '@hansard/db';
import { REACTION_CANDIDATE_EMOJIS, REACTION_FPTP_MAX_CANDIDATES } from '@hansard/shared';
import { db } from '../../db.js';

/**
 * Shared helpers for seeding FPTP candidate-position emoji (1️⃣..9️⃣) onto
 * a reaction-mode vote message.
 *
 * Two trigger sites:
 *   A. /vote candidate-submit — top up the next emoji when a candidate registers
 *      while the vote message already exists. Responsive UX so the embed
 *      grows reactions as nominations come in.
 *   B. /vote open             — at the status flip to `voting_open`, walk every
 *      non-withdrawn candidate (in registeredAt order, matching the cast
 *      handler in events/messageReactionAdd.ts) and seed reactions 1..N.
 *      Idempotent because Discord drops duplicate-add reactions on the
 *      bot's own emoji.
 *
 * The reaction-vote handler maps emoji → candidate by position, so seeding
 * ORDER MUST match `candidates ORDER BY registeredAt ASC` exactly.
 *
 * If the message can't be fetched (deleted, unknown channel, etc.) we log
 * and return without throwing — callers must NOT crash on a stale message.
 */

export type FetchedVoteMessage = {
  message: Message;
  channel: TextChannel | NewsChannel | ThreadChannel;
};

/**
 * Fetch the vote message by IDs from the election row. Returns null on any
 * failure (deleted message, channel gone, missing perms, non-text channel).
 * Errors are logged but not rethrown.
 */
export async function fetchVoteMessage(
  client: Client,
  channelId: string | null | undefined,
  messageId: string | null | undefined,
): Promise<FetchedVoteMessage | null> {
  if (!channelId || !messageId) return null;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return null;
    }
    const message = await channel.messages.fetch(messageId);
    return {
      message,
      channel: channel as TextChannel | NewsChannel | ThreadChannel,
    };
  } catch (error) {
    console.error(
      `[seedFptpReactions] failed to fetch vote message ${messageId} in channel ${channelId}:`,
      error,
    );
    return null;
  }
}

/**
 * Add a single emoji reaction. Best-effort — logs and swallows on failure
 * (Discord ignores duplicate-add reactions on the bot's own emoji, so this
 * is safe to call multiple times for the same position).
 */
async function safeReact(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch (error) {
    console.error(`[seedFptpReactions] failed to seed ${emoji} on ${message.id}:`, error);
  }
}

/**
 * Trigger A: A candidate just registered. Count current non-withdrawn
 * candidates and add ONE reaction at the new position (count - 1, 0-based).
 *
 * If the new candidate is the 10th (or beyond), there's no emoji to add —
 * we return `{ overflow: true }` so the caller can surface a warning.
 *
 * Returns { overflow, capacityReached } so the caller can shape the user
 * message ("you're candidate #10 — switch to button mode").
 */
export async function seedReactionForNewCandidate(params: {
  client: Client;
  electionId: string;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
}): Promise<{ overflow: boolean; capacityReached: boolean; seeded: boolean }> {
  const { client, electionId, channelId, messageId } = params;

  // Recount non-withdrawn candidates ordered by registration. The newly
  // inserted row will be the last entry — we're computing its 1-based slot.
  const rows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.electionId, electionId),
        eq(candidates.isWithdrawn, false),
      ),
    )
    .orderBy(candidates.registeredAt);

  const count = rows.length;

  if (count === 0) {
    return { overflow: false, capacityReached: false, seeded: false };
  }

  if (count > REACTION_FPTP_MAX_CANDIDATES) {
    return { overflow: true, capacityReached: true, seeded: false };
  }

  const fetched = await fetchVoteMessage(client, channelId, messageId);
  if (!fetched) {
    return { overflow: false, capacityReached: count === REACTION_FPTP_MAX_CANDIDATES, seeded: false };
  }

  const emoji = REACTION_CANDIDATE_EMOJIS[count - 1];
  await safeReact(fetched.message, emoji);

  return {
    overflow: false,
    capacityReached: count === REACTION_FPTP_MAX_CANDIDATES,
    seeded: true,
  };
}

/**
 * Trigger B: Voting is being opened. Walk every non-withdrawn candidate in
 * registration order and seed all of 1️⃣..N. Idempotent — duplicates are
 * harmless (Discord ignores re-add on bot's own reaction).
 *
 * Caps at REACTION_FPTP_MAX_CANDIDATES (9). Returns
 * { totalCandidates, seededCount, overflow } so the caller can warn staff
 * if not every candidate got a reaction.
 */
export async function seedAllReactionsForOpenVote(params: {
  client: Client;
  electionId: string;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
}): Promise<{ totalCandidates: number; seededCount: number; overflow: boolean }> {
  const { client, electionId, channelId, messageId } = params;

  const rows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.electionId, electionId),
        eq(candidates.isWithdrawn, false),
      ),
    )
    .orderBy(candidates.registeredAt);

  const totalCandidates = rows.length;
  if (totalCandidates === 0) {
    return { totalCandidates: 0, seededCount: 0, overflow: false };
  }

  const fetched = await fetchVoteMessage(client, channelId, messageId);
  if (!fetched) {
    return {
      totalCandidates,
      seededCount: 0,
      overflow: totalCandidates > REACTION_FPTP_MAX_CANDIDATES,
    };
  }

  const seedCount = Math.min(totalCandidates, REACTION_FPTP_MAX_CANDIDATES);

  // Sequential add — Discord's reaction add endpoint is heavily rate-limited
  // and parallel calls just queue at the gateway anyway. Keeps the order
  // visually correct (1️⃣ before 2️⃣) on the embed.
  for (let i = 0; i < seedCount; i++) {
    await safeReact(fetched.message, REACTION_CANDIDATE_EMOJIS[i]);
  }

  return {
    totalCandidates,
    seededCount: seedCount,
    overflow: totalCandidates > REACTION_FPTP_MAX_CANDIDATES,
  };
}
