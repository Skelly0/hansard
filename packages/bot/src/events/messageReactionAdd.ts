import {
  Events,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { ballots, candidates, elections, players } from '@hansard/db';
import {
  hasVotingCloseTimePassed,
  REACTION_CANDIDATE_EMOJIS,
  REACTION_EMOJI,
  REACTION_FPTP_MAX_CANDIDATES,
} from '@hansard/shared';
import { db } from '../db.js';
import { handlePartyJoinReaction } from '../utils/partyJoinMessage.js';

/**
 * MessageReactionAdd handler — implements public reaction-mode voting.
 *
 * Triggered for ANY reaction on ANY message the bot can see. Cheap fast-path:
 * we look up `elections` by `discordMessageId` first, and bail out instantly
 * if there's no matching open reaction-mode election.
 *
 * Flow on a match:
 *   1. Resolve player by Discord ID (require existing /character — we do NOT
 *      auto-create here: people may react out of curiosity).
 *   2. Map the emoji to a ballot value (yea/nay/abstain or candidate by index).
 *   3. Run eligibility checks (status/window open, faction/party filters).
 *   4. Atomically replace the existing ballot (delete + insert in a transaction)
 *      — reaction mode is public voting where changing your mind is
 *      part of the design.
 *   5. Leave the user's reaction in place so the Discord message itself is
 *      the public voting record.
 *
 * Race-condition note: the discord.js global InteractionCreate vs awaiter race
 * (CLAUDE.md) does NOT apply here — MessageReactionAdd is a separate event
 * that no command awaits. We can act freely.
 *
 * Errors are reported by DM to the reacting user where useful; we never reply
 * in the channel and we do not remove reactions from the vote message. Success
 * confirmation DMs can be enabled with REACTION_VOTE_CONFIRMATION_DMS=true.
 */

type ReactionInput = MessageReaction | PartialMessageReaction;
type UserInput = User | PartialUser;

function shouldSendReactionVoteConfirmationDm(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.REACTION_VOTE_CONFIRMATION_DMS?.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value ?? '');
}

async function notifyByDm(user: UserInput, message: string): Promise<void> {
  try {
    const fullUser = user.partial ? await user.fetch() : (user as User);
    await fullUser.send(message);
  } catch {
    // User has DMs closed — nothing we can do.
  }
}

/**
 * Translate a reaction emoji into a candidate index (0-based) for FPTP mode,
 * or -1 if the emoji isn't a valid candidate marker.
 */
function fptpEmojiToIndex(emoji: string): number {
  const idx = (REACTION_CANDIDATE_EMOJIS as readonly string[]).indexOf(emoji);
  return idx;
}

async function handleReaction(reaction: ReactionInput, user: UserInput): Promise<void> {
  // Ignore the bot's own seed reactions.
  if (user.bot) return;

  // Hydrate partials. Reactions on messages cached before bot startup arrive
  // partial; without fetch() we can't read the emoji or the message ID.
  let fullReaction: MessageReaction;
  try {
    fullReaction = reaction.partial ? await reaction.fetch() : (reaction as MessageReaction);
  } catch (error) {
    console.error('[reaction-vote] failed to fetch partial reaction:', error);
    return;
  }

  const messageId = fullReaction.message.id;
  const emoji = fullReaction.emoji.name; // unicode emoji or custom name; we only support unicode
  if (!emoji) return;

  // Fast path: is there an OPEN reaction-mode election attached to this message?
  const [election] = await db
    .select()
    .from(elections)
    .where(eq(elections.discordMessageId, messageId))
    .limit(1);

  if (!election || !election.useReactions) {
    await handlePartyJoinReaction(fullReaction, user);
    return;
  }

  if (election.status !== 'voting_open') {
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded — voting is closed.`,
    );
    return;
  }
  if (hasVotingCloseTimePassed(election.votingClosesAt)) {
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded — voting is closed.`,
    );
    return;
  }

  // Determine which ballot this reaction represents.
  let votePayload: typeof ballots.$inferInsert.vote | null = null;
  let voteLabel = '';

  if (election.method === 'yea_nay_abstain') {
    if (emoji === REACTION_EMOJI.YEA) {
      votePayload = { type: 'yea_nay_abstain', choice: 'yea' };
      voteLabel = 'Yea';
    } else if (emoji === REACTION_EMOJI.NAY) {
      votePayload = { type: 'yea_nay_abstain', choice: 'nay' };
      voteLabel = 'Nay';
    } else if (emoji === REACTION_EMOJI.ABSTAIN) {
      votePayload = { type: 'yea_nay_abstain', choice: 'abstain' };
      voteLabel = 'Abstain';
    }
  } else if (election.method === 'fptp') {
    const idx = fptpEmojiToIndex(emoji);
    if (idx >= 0 && idx < REACTION_FPTP_MAX_CANDIDATES) {
      // Resolve candidate by registration order. Withdrawn candidates are skipped.
      const rows = await db
        .select({ playerId: candidates.playerId })
        .from(candidates)
        .where(
          and(
            eq(candidates.electionId, election.id),
            eq(candidates.isWithdrawn, false),
          ),
        )
        .orderBy(candidates.registeredAt);

      const candidate = rows[idx];
      if (candidate) {
        votePayload = { type: 'fptp', candidateId: candidate.playerId };
        voteLabel = `Candidate #${idx + 1}`;
      }
    }
  }

  if (!votePayload) {
    // Unrecognised emoji on a vote message — leave it alone. Staff can clean
    // message clutter manually, but the bot never removes public vote reactions.
    return;
  }

  // Resolve the player. Reaction mode does NOT auto-create players; require
  // an explicit /character first to avoid silently registering casual reactors.
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, user.id))
    .limit(1);

  if (!player) {
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded — you are not registered as a player. Run \`/character create\` first.`,
    );
    return;
  }
  if (!player.characterName) {
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded — you have not created a character yet. Run \`/character create\` first.`,
    );
    return;
  }
  if (player.isAlive === false) {
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded — dead characters cannot vote.`,
    );
    return;
  }

  // Eligibility filters — mirror /vote-eligibility logic for faction/party.
  const config = election.config ?? {};
  if (config.eligibleFactions?.length) {
    if (!player.factionId || !config.eligibleFactions.includes(player.factionId)) {
      await notifyByDm(
        user,
        `Your reaction on **${election.title}** was not recorded — your faction is not eligible to vote in this election.`,
      );
      return;
    }
  }
  if (config.eligibleParties?.length) {
    if (!player.partyId || !config.eligibleParties.includes(player.partyId)) {
      await notifyByDm(
        user,
        `Your reaction on **${election.title}** was not recorded — your party is not eligible to vote in this election.`,
      );
      return;
    }
  }

  // Record the ballot. Reaction-mode votes are mutable: a second reaction
  // replaces the first. We delete-then-insert in a transaction so the
  // `ballots_election_voter_unique` constraint can't trip on the way in.
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(ballots)
        .where(
          and(
            eq(ballots.electionId, election.id),
            eq(ballots.voterId, player.id),
          ),
        );

      await tx.insert(ballots).values({
        electionId: election.id,
        voterId: player.id,
        vote: votePayload!,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[reaction-vote] failed to record ballot for ${user.id} on ${election.id}:`, message);
    await notifyByDm(
      user,
      `Your reaction on **${election.title}** was not recorded due to an internal error. Please try \`/vote-cast\` instead, or contact staff.`,
    );
    return;
  }

  // Quiet success — opt-in confirmation DM for servers that want it.
  if (shouldSendReactionVoteConfirmationDm()) {
    await notifyByDm(
      user,
      `Your **${voteLabel}** vote on **${election.title}** has been recorded.`,
    );
  }
}

export function registerMessageReactionAddEvent(client: Client): void {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await handleReaction(reaction, user);
    } catch (error) {
      console.error('[reaction-vote] unhandled error in MessageReactionAdd handler:', error);
    }
  });
}
