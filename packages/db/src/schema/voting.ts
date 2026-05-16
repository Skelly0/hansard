import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { players, offices, parties } from './players';

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description'),
  type: varchar('type', { length: 32 }).notNull(),
  // 'legislative_vote'           -- vote on a bill (Chancellor only)
  // 'position_election'          -- elect someone to an office (Chancellor creates, candidates submit)
  // 'appointment_confirmation'   -- confirm a PM appointment (yea/nay)
  // 'general_election'           -- e.g. general elections for parliament seats
  // 'party_primary'              -- internal party vote
  // 'referendum'                 -- public vote on a question
  // 'confidence_vote'            -- vote of confidence/no confidence
  // 'constitutional_amendment'   -- supermajority required
  // 'custom'                     -- catch-all for anything else

  // Voting method
  method: varchar('method', { length: 32 }).notNull(),
  // 'fptp' | 'ranked_choice' | 'stv' | 'approval' | 'proportional'
  // | 'yea_nay_abstain' | 'two_round_runoff' | 'exhaustive_ballot'

  // === WHO CAN CREATE ===
  // Any player can create: referendum, party_primary, confidence_vote, custom
  // Chancellor (legislative_leader) only: legislative_vote, position_election, appointment_confirmation
  // Staff: any type
  requiredPermission: varchar('required_permission', { length: 32 }),
  // null = any player, 'legislative_leader' = Chancellor, 'staff' = staff only

  // Configuration
  config: jsonb('config').$type<{
    // === MAJORITY & THRESHOLD ===
    quorumRequired?: number;
    quorumType?: 'absolute' | 'percentage';
    passThreshold?: number;              // 0.5 = simple majority, 2/3 = supermajority, 0.75 = three-quarters
    majorityType?: 'simple' | 'absolute' | 'supermajority' | 'qualified' | 'unanimous';
    // 'simple' = more yea than nay (of those who vote)
    // 'absolute' = more than half of ALL eligible voters (not just those who voted)
    // 'supermajority' = uses passThreshold (e.g. 2/3)
    // 'qualified' = custom threshold
    // 'unanimous' = 100%

    // === CANDIDATE ELECTIONS ===
    seatsAvailable?: number;
    maxChoices?: number;                 // for approval voting

    // === RUNOFF CONFIG ===
    runoffEnabled?: boolean;             // if no majority in first round, trigger runoff
    runoffMethod?: 'top_two' | 'exhaustive' | 'instant';
    // 'top_two' = top 2 candidates go to a new vote
    // 'exhaustive' = lowest eliminated, re-vote until majority (multiple rounds)
    // 'instant' = ranked choice (instant runoff, single ballot)
    runoffThreshold?: number;            // % needed to win outright in first round (default 0.5)

    // === PROPORTIONAL ===
    proportionalMethod?: 'dhondt' | 'sainte_lague' | 'hare';

    // === VISIBILITY ===
    sealedResults?: boolean;
    anonymousBallots?: boolean;

    // === ELIGIBILITY ===
    eligibleFactions?: string[];
    eligibleParties?: string[];
    eligibleOffices?: string[];
    requireRegistration?: boolean;

    // === NPC HOUSE CONFIRMATION (for position elections / appointments) ===
    requiresNpcConfirmation?: boolean;   // does the winner need NPC house approval?
  }>().notNull(),

  // === POSITION LINK ===
  // If this election is for a specific office (governor, minister, etc.)
  // Winner is automatically appointed to the office on certification.
  forOfficeId: uuid('for_office_id').references(() => offices.id),

  // === NPC CONFIRMATION (for position elections) ===
  npcConfirmation: jsonb('npc_confirmation').$type<{
    status: 'pending' | 'confirmed' | 'rejected';
    tally?: {
      yea: number;
      nay: number;
      abstain: number;
      total: number;
    };
    decidedAt?: string;
    enteredById?: string;
    notes?: string;
  }>(),

  // === RUNOFF TRACKING ===
  parentElectionId: uuid('parent_election_id').references((): AnyPgColumn => elections.id),
  // If this is a runoff, points to the original election
  roundNumber: integer('round_number').default(1).notNull(),

  // Timing
  nominationsOpenAt: timestamp('nominations_open_at', { withTimezone: true, mode: 'date' }),
  nominationsCloseAt: timestamp('nominations_close_at', { withTimezone: true, mode: 'date' }),
  votingOpensAt: timestamp('voting_opens_at', { withTimezone: true, mode: 'date' }).notNull(),
  votingClosesAt: timestamp('voting_closes_at', { withTimezone: true, mode: 'date' }).notNull(),

  // Status
  status: varchar('status', { length: 32 }).default('draft').notNull(),
  // 'draft' | 'nominations_open' | 'nominations_closed' | 'voting_open' | 'voting_closed'
  // | 'tallied' | 'runoff_needed' | 'npc_pending' | 'certified' | 'cancelled'

  // Results (populated after tallying)
  results: jsonb('results').$type<{
    totalVotes: number;
    turnout: number;
    quorumMet?: boolean;
    passed?: boolean;                    // for yea/nay
    rounds?: {                           // for ranked choice / elimination
      round: number;
      tallies: Record<string, number>;
      eliminated?: string;
    }[];
    finalTallies: Record<string, number>;
    winners?: string[];                  // candidate IDs or 'yea'/'nay'
    seatAllocation?: Record<string, number>;
    runoffTriggered?: boolean;           // true if no candidate met threshold
    runoffElectionId?: string;           // the follow-up election
  }>(),

  // Relationships
  relatedBillId: uuid('related_bill_id'), // references bills.id — linked at query time to avoid circular import
  createdById: uuid('created_by_id').references(() => players.id).notNull(),

  // Discord
  discordMessageId: varchar('discord_message_id', { length: 20 }),
  discordChannelId: varchar('discord_channel_id', { length: 20 }),

  // === REACTION-MODE VOTING ===
  // When true, votes are cast by reacting to the public Discord embed
  // (discordMessageId + discordChannelId) rather than via ephemeral buttons.
  // Only valid for `yea_nay_abstain` and `fptp` (with <= 9 candidates).
  // The `MessageReactionAdd` listener filters by an open election whose
  // discordMessageId matches the reacted message.
  useReactions: boolean('use_reactions').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  electionId: uuid('election_id').references(() => elections.id).notNull(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  partyId: uuid('party_id').references(() => parties.id),

  statement: text('statement'),             // candidate statement / manifesto
  nominatedById: uuid('nominated_by_id').references(() => players.id),

  isWithdrawn: boolean('is_withdrawn').default(false).notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const ballots = pgTable('ballots', {
  id: uuid('id').primaryKey().defaultRandom(),
  electionId: uuid('election_id').references(() => elections.id).notNull(),
  voterId: uuid('voter_id').references(() => players.id).notNull(),

  // The actual vote -- structure depends on method
  vote: jsonb('vote').$type<
    | { type: 'fptp'; candidateId: string }
    | { type: 'ranked'; ranking: string[] }                    // ranked_choice / STV
    | { type: 'approval'; approved: string[] }
    | { type: 'yea_nay_abstain'; choice: 'yea' | 'nay' | 'abstain' }
    | { type: 'two_round'; candidateId: string }               // same as fptp per round
    | { type: 'exhaustive'; candidateId: string }              // same as fptp per round
  >().notNull(),

  castAt: timestamp('cast_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  electionVoterUnique: uniqueIndex('ballots_election_voter_unique').on(table.electionId, table.voterId),
}));
