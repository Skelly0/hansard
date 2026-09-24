/**
 * Vote Service — business logic for the entire election lifecycle.
 *
 * Handles creation, candidate registration, ballot casting, tallying,
 * runoff generation, NPC confirmation, and certification (with auto
 * office-appointment on certified position elections).
 */
import { eq, and, asc, exists, gt, ilike, inArray, isNotNull, isNull, sql, gte, lte, or, ne } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import {
  elections,
  candidates,
  ballots,
  bills,
  billStatusLog,
  players,
  parties,
  offices,
  officeHolders,
  simulationClock,
} from '@hansard/db';
import type {
  ElectionConfig,
  BallotVote,
  NpcConfirmation,
  ElectionResults,
  TallyResult,
  VotingMethod,
  ElectionType,
  ElectionStatus,
} from '@hansard/shared';
import { BillStatus, DEFAULT_VOTE_DURATION_MS, hasVotingCloseTimePassed } from '@hansard/shared';
import { getStrategy } from './tallying/index.js';
import { TwoRoundRunoffStrategy } from './tallying/twoRoundRunoff.js';
import { ExhaustiveBallotStrategy } from './tallying/exhaustiveBallot.js';
import { appointToOffice } from './officeService.js';
import { lookupPlayerSummaries } from './playerSummaries.js';

// ============================================================
// Election update allowlist
// ============================================================

// Fields a PATCH may write directly. Anything else (id, createdById, results,
// type, relatedBillId, …) is intentionally NOT here so a raw request body can't
// mass-assign integrity columns via `.set({ ...body })`. Lifecycle changes
// (status moves through certify/open/close, the voting window, etc.) are gated
// at the route layer; this list is the last-line boundary for any caller.
const ELECTION_UPDATE_PASSTHROUGH_FIELDS = [
  'title',
  'description',
  'config',
  'status',
  'discordMessageId',
  'discordChannelId',
] as const;

const ELECTION_UPDATE_DATE_FIELDS = [
  'votingOpensAt',
  'votingClosesAt',
  'nominationsOpenAt',
  'nominationsCloseAt',
] as const;

/**
 * Build the Drizzle `.set(...)` payload for an election update from an explicit
 * allowlist, coercing JSON date strings to `Date`.
 *
 * Exported so the allowlist + coercion can be unit-tested without a DB. Throws
 * on an unparseable date so a bad value surfaces instead of silently no-op'ing.
 */
export function buildElectionUpdateSet(
  data: Record<string, unknown>,
  now: Date,
): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: now };

  for (const key of ELECTION_UPDATE_PASSTHROUGH_FIELDS) {
    if (data[key] !== undefined) set[key] = data[key];
  }

  // JSON can only carry dates as strings; coerce them so Drizzle's mode:'date'
  // columns don't call .toISOString() on a string and throw.
  for (const key of ELECTION_UPDATE_DATE_FIELDS) {
    const value = data[key];
    if (value === undefined) continue;
    if (value instanceof Date) {
      set[key] = value;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const coerced = new Date(value);
      if (!Number.isNaN(coerced.getTime())) {
        set[key] = coerced;
        continue;
      }
    }
    throw new Error(`Invalid value for ${key}`);
  }

  return set;
}

// ============================================================
// Types for service inputs
// ============================================================

export interface CreateElectionInput {
  title: string;
  description?: string;
  type: ElectionType;
  method: VotingMethod;
  config: ElectionConfig;
  requiredPermission?: string;
  forOfficeId?: string;
  relatedBillId?: string;
  parentElectionId?: string;
  roundNumber?: number;
  nominationsOpenAt?: Date;
  nominationsCloseAt?: Date;
  votingOpensAt: Date;
  votingClosesAt: Date;
  discordChannelId?: string;
  createdById: string;
}

export interface ListElectionsFilter {
  status?: ElectionStatus;
  /**
   * Convenience grouping:
   *   - 'active'  = anything still in motion (draft → npc_pending)
   *   - 'past'    = closed votes (tallied, certified, cancelled)
   *   - 'all' or undefined = no status grouping filter
   * Ignored if `status` is set (explicit wins).
   */
  scope?: 'active' | 'past' | 'all';
  type?: ElectionType;
  method?: VotingMethod;
  forOfficeId?: string;
  createdById?: string;
  /** Case-insensitive title substring. */
  search?: string;
  /** ISO date string — only return elections created on/after this. */
  since?: string;
  /** ISO date string — only return elections created on/before this. */
  until?: string;
  limit?: number;
  offset?: number;
  /** 1-based page number; if provided, overrides `offset`. */
  page?: number;
}

export interface ElectionViewer {
  userId: string;
  isStaff: boolean;
}

/** Statuses considered "active" for the scope filter. */
const ACTIVE_STATUSES: ElectionStatus[] = [
  'draft',
  'nominations_open',
  'nominations_closed',
  'voting_open',
  'voting_closed',
  'tallied',
  'runoff_needed',
  'npc_pending',
];

/** Statuses considered "past" / archived for the scope filter. */
const PAST_STATUSES: ElectionStatus[] = ['certified', 'cancelled'];

function parseNpcTallyValue(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error('NPC tally values must be non-negative integers');
  }
  return value;
}

export interface CastBallotInput {
  electionId: string;
  voterId: string;
  vote: BallotVote;
}

export interface RegisterCandidateInput {
  electionId: string;
  playerId: string;
  /** Omit to use the candidate's current party; null stands them as an independent. */
  partyId?: string | null;
  statement?: string;
  nominatedById?: string;
}

export interface NpcConfirmInput {
  yea: number;
  nay: number;
  abstain: number;
  enteredById: string;
  notes?: string;
}

// ============================================================
// Service
// ============================================================

type EligibilityPlayer = {
  characterName: string | null;
  isAlive: boolean;
  factionId: string | null;
  partyId: string | null;
};

const NOT_IN_ELIGIBLE_OFFICE = 'You do not hold an eligible office for this election';

/** Character-level reasons a player can't vote at all. */
function characterIneligibility(player: EligibilityPlayer): string | null {
  if (!player.characterName) return 'Character registration is required';
  if (!player.isAlive) return 'Dead characters cannot vote';
  return null;
}

/** Faction/party filters on an election's config. */
function affiliationIneligibility(config: ElectionConfig, player: EligibilityPlayer): string | null {
  if (config.eligibleFactions?.length) {
    if (!player.factionId || !config.eligibleFactions.includes(player.factionId)) {
      return 'Your faction is not eligible to vote in this election';
    }
  }
  if (config.eligibleParties?.length) {
    if (!player.partyId || !config.eligibleParties.includes(player.partyId)) {
      return 'Your party is not eligible to vote in this election';
    }
  }
  return null;
}

export class VoteService {
  constructor(private db: Database) {}

  private canViewElection(
    election: { status: string; createdById: string },
    viewer?: ElectionViewer,
  ): boolean {
    if (!viewer || viewer.isStaff) return true;
    return election.status !== 'draft' || election.createdById === viewer.userId;
  }

  private visibleElectionCondition(viewer?: ElectionViewer) {
    if (!viewer || viewer.isStaff) return undefined;
    return or(ne(elections.status, 'draft'), eq(elections.createdById, viewer.userId));
  }

  private async getEligibilityForElection(
    election: typeof elections.$inferSelect,
    playerId: string,
  ): Promise<{ eligible: boolean; reason?: string }> {
    if (election.status !== 'voting_open') {
      return { eligible: false, reason: 'Voting is not open' };
    }
    if (hasVotingCloseTimePassed(election.votingClosesAt)) {
      return { eligible: false, reason: 'Voting has closed' };
    }

    const [player] = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        factionId: players.factionId,
        partyId: players.partyId,
        isAlive: players.isAlive,
      })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);

    if (!player) {
      return { eligible: false, reason: 'Player not found' };
    }

    const config = election.config as ElectionConfig;
    const blocked = characterIneligibility(player) ?? affiliationIneligibility(config, player);
    if (blocked) {
      return { eligible: false, reason: blocked };
    }

    if (config.eligibleOffices?.length) {
      const [holding] = await this.db
        .select({ id: officeHolders.id })
        .from(officeHolders)
        .where(and(
          eq(officeHolders.playerId, playerId),
          isNull(officeHolders.endDate),
          inArray(officeHolders.officeId, config.eligibleOffices),
        ))
        .limit(1);

      if (!holding) {
        return { eligible: false, reason: NOT_IN_ELIGIBLE_OFFICE };
      }
    }

    const existing = await this.db
      .select({ id: ballots.id })
      .from(ballots)
      .where(and(eq(ballots.electionId, election.id), eq(ballots.voterId, playerId)))
      .limit(1);

    if (existing.length > 0) {
      return { eligible: false, reason: 'Already voted' };
    }

    return { eligible: true };
  }

  private candidateIdsFromVote(vote: BallotVote): string[] {
    switch (vote.type) {
      case 'fptp':
      case 'two_round':
      case 'exhaustive':
        return [vote.candidateId];
      case 'approval':
        return vote.approved;
      case 'ranked':
        return vote.ranking;
      case 'yea_nay_abstain':
        return [];
    }
  }

  private async validateCandidateChoices(electionId: string, vote: BallotVote): Promise<void> {
    const candidateIds = [...new Set(this.candidateIdsFromVote(vote))];
    if (candidateIds.length === 0) return;

    const rows = await this.db
      .select({ playerId: candidates.playerId })
      .from(candidates)
      .where(and(
        eq(candidates.electionId, electionId),
        eq(candidates.isWithdrawn, false),
        inArray(candidates.playerId, candidateIds),
      ));

    const validIds = new Set(rows.map((row) => row.playerId));
    const invalidIds = candidateIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error('Ballot includes a candidate who is not registered for this election');
    }
  }

  // ----------------------------------------------------------
  // Create
  // ----------------------------------------------------------

  async createElection(data: CreateElectionInput) {
    const [election] = await this.db
      .insert(elections)
      .values({
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        method: data.method,
        config: data.config,
        requiredPermission: data.requiredPermission ?? null,
        forOfficeId: data.forOfficeId ?? null,
        relatedBillId: data.relatedBillId ?? null,
        parentElectionId: data.parentElectionId ?? null,
        roundNumber: data.roundNumber ?? 1,
        nominationsOpenAt: data.nominationsOpenAt ?? null,
        nominationsCloseAt: data.nominationsCloseAt ?? null,
        votingOpensAt: data.votingOpensAt,
        votingClosesAt: data.votingClosesAt,
        discordChannelId: data.discordChannelId ?? null,
        createdById: data.createdById,
        status: 'draft',
      })
      .returning();

    return election;
  }

  // ----------------------------------------------------------
  // Read
  // ----------------------------------------------------------

  async getElection(id: string, viewer?: ElectionViewer) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, id))
      .limit(1);

    if (!election) return null;
    if (!this.canViewElection(election, viewer)) return null;

    const [enriched] = await this.enrichElectionsForDisplay([election]);
    return enriched;
  }

  /**
   * Attach the display summaries the web/MCP render next to raw ids:
   * `relatedBillSlug`, `forOffice`, `createdBy`, and `candidates` (ordered by
   * registration, each with nested `player`/`party` summaries). Candidate
   * rows and names are public ballot information, so no viewer gating here —
   * visibility of the election itself is enforced by the callers.
   */
  private async enrichElectionsForDisplay<T extends {
    id: string;
    relatedBillId: string | null;
    forOfficeId: string | null;
    createdById: string;
  }>(rows: T[], { statements = true }: { statements?: boolean } = {}) {
    if (rows.length === 0) return [];
    const electionIds = rows.map((r) => r.id);
    const officeIds = [...new Set(rows.map((r) => r.forOfficeId).filter((x): x is string => !!x))];
    const creatorIds = [...new Set(rows.map((r) => r.createdById))];

    const [withSlugs, officeRows, creatorMap, candidateRows] = await Promise.all([
      this.enrichElectionsWithSlugs(rows),
      officeIds.length
        ? this.db.select({ id: offices.id, name: offices.name }).from(offices).where(inArray(offices.id, officeIds))
        : Promise.resolve([] as { id: string; name: string }[]),
      lookupPlayerSummaries(this.db, creatorIds),
      this.db
        .select({
          // Lists need the roster (to name a winner) but not the manifestos,
          // which are only read on the election's own page.
          candidate: statements
            ? candidates
            : {
              id: candidates.id,
              electionId: candidates.electionId,
              playerId: candidates.playerId,
              partyId: candidates.partyId,
              nominatedById: candidates.nominatedById,
              isWithdrawn: candidates.isWithdrawn,
              registeredAt: candidates.registeredAt,
            },
          playerCharacterName: players.characterName,
          playerDiscordUsername: players.discordUsername,
          partyName: parties.name,
          partyShortName: parties.shortName,
          partyColour: parties.colour,
        })
        .from(candidates)
        .leftJoin(players, eq(candidates.playerId, players.id))
        .leftJoin(parties, eq(candidates.partyId, parties.id))
        .where(inArray(candidates.electionId, electionIds))
        .orderBy(candidates.registeredAt, candidates.id),
    ]);

    const officeMap = new Map(officeRows.map((o) => [o.id, o]));
    const candidatesByElection = new Map<string, unknown[]>();
    for (const row of candidateRows) {
      const c = row.candidate;
      const list = candidatesByElection.get(c.electionId) ?? [];
      list.push({
        ...c,
        player: {
          id: c.playerId,
          characterName: row.playerCharacterName,
          discordUsername: row.playerDiscordUsername ?? '',
        },
        party: c.partyId && row.partyName
          ? { id: c.partyId, name: row.partyName, shortName: row.partyShortName, colour: row.partyColour }
          : null,
      });
      candidatesByElection.set(c.electionId, list);
    }

    return withSlugs.map((row) => {
      const office = row.forOfficeId ? officeMap.get(row.forOfficeId) : undefined;
      const creator = creatorMap.get(row.createdById);
      return {
        ...row,
        forOffice: office ? { id: office.id, name: office.name } : null,
        createdBy: creator
          ? { id: creator.id, characterName: creator.characterName, discordUsername: creator.discordUsername }
          : null,
        candidates: (candidatesByElection.get(row.id) ?? []) as Array<Omit<typeof candidates.$inferSelect, 'statement'> & {
          /** Absent on list responses; only the election detail carries statements. */
          statement?: string | null;
          player: { id: string; characterName: string | null; discordUsername: string };
          party: { id: string; name: string; shortName: string | null; colour: string | null } | null;
        }>,
      };
    });
  }

  private async isNpcHouseActive(executor: Pick<Database, 'select'> = this.db): Promise<boolean> {
    const [clock] = await executor
      .select({ npcHouseActive: simulationClock.npcHouseActive })
      .from(simulationClock)
      .limit(1);

    return clock?.npcHouseActive ?? false;
  }

  private async updateRelatedBillAfterTally(
    tx: Pick<Database, 'select' | 'update' | 'insert'>,
    election: typeof elections.$inferSelect,
    result: TallyResult,
    talliedAt: Date,
  ): Promise<void> {
    if (
      election.type !== 'legislative_vote' ||
      !election.relatedBillId ||
      result.runoffTriggered ||
      typeof result.passed !== 'boolean'
    ) {
      return;
    }

    const npcHouseActive = result.passed ? await this.isNpcHouseActive(tx) : false;
    const playerVoteResult = result.passed ? 'passed' : 'rejected';
    const toStatus = result.passed
      ? npcHouseActive ? BillStatus.NPC_PENDING : BillStatus.PLAYER_PASSED
      : BillStatus.PLAYER_REJECTED;

    await tx
      .update(bills)
      .set({
        status: toStatus,
        playerVoteResult,
        playerVoteAt: talliedAt,
        npcVoteRequired: npcHouseActive,
        npcVote: npcHouseActive ? { status: 'pending' as const } : null,
        updatedAt: talliedAt,
      })
      .where(eq(bills.id, election.relatedBillId));

    await tx.insert(billStatusLog).values({
      billId: election.relatedBillId,
      fromStatus: BillStatus.VOTING,
      toStatus,
      changedById: election.createdById,
      notes: result.passed
        ? npcHouseActive
          ? `Player house vote passed (election ${election.id}); NPC house review is pending`
          : `Player house vote passed (election ${election.id}); NPC house is inactive; bill awaits enactment`
        : `Player house vote rejected (election ${election.id})`,
    });
  }

  private async enrichElectionsWithSlugs<T extends { id: string; relatedBillId: string | null }>(
    rows: T[],
  ): Promise<(T & { relatedBillSlug: string | null })[]> {
    const billIds = [...new Set(rows.map((r) => r.relatedBillId).filter((x): x is string => !!x))];
    if (!billIds.length) {
      return rows.map((r) => ({ ...r, relatedBillSlug: null }));
    }
    const billRows = await this.db
      .select({ id: bills.id, slug: bills.slug })
      .from(bills)
      .where(inArray(bills.id, billIds));
    const slugMap = new Map(billRows.map((b) => [b.id, b.slug]));
    return rows.map((r) => ({
      ...r,
      relatedBillSlug: r.relatedBillId ? slugMap.get(r.relatedBillId) ?? null : null,
    }));
  }

  async listElections(filters: ListElectionsFilter = {}, viewer?: ElectionViewer) {
    const conditions = [];
    const visibility = this.visibleElectionCondition(viewer);
    if (visibility) {
      conditions.push(visibility);
    }

    if (filters.status) {
      // Explicit status wins over scope grouping.
      conditions.push(eq(elections.status, filters.status));
    } else if (filters.scope === 'active') {
      conditions.push(inArray(elections.status, ACTIVE_STATUSES));
    } else if (filters.scope === 'past') {
      conditions.push(inArray(elections.status, PAST_STATUSES));
    }
    if (filters.type) {
      conditions.push(eq(elections.type, filters.type));
    }
    if (filters.search?.trim()) {
      // Escape LIKE wildcards so a literal % or _ in the query matches itself.
      const term = filters.search.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
      conditions.push(ilike(elections.title, `%${term}%`));
    }
    if (filters.method) {
      conditions.push(eq(elections.method, filters.method));
    }
    if (filters.forOfficeId) {
      conditions.push(eq(elections.forOfficeId, filters.forOfficeId));
    }
    if (filters.createdById) {
      conditions.push(eq(elections.createdById, filters.createdById));
    }
    if (filters.since) {
      const sinceDate = new Date(filters.since);
      if (!Number.isNaN(sinceDate.getTime())) {
        conditions.push(gte(elections.createdAt, sinceDate));
      }
    }
    if (filters.until) {
      const untilDate = new Date(filters.until);
      if (!Number.isNaN(untilDate.getTime())) {
        conditions.push(lte(elections.createdAt, untilDate));
      }
    }

    const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
    const offset = filters.page && filters.page > 0
      ? (filters.page - 1) * limit
      : Math.max(0, filters.offset ?? 0);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Sort by recency: prefer the most recent meaningful timestamp
    // (votingClosesAt for past votes, createdAt for everything else).
    const orderExpr = sql`COALESCE(${elections.votingClosesAt}, ${elections.createdAt}) DESC`;

    const [rows, totalRow] = await Promise.all([
      whereClause
        ? this.db.select().from(elections).where(whereClause).orderBy(orderExpr).limit(limit).offset(offset)
        : this.db.select().from(elections).orderBy(orderExpr).limit(limit).offset(offset),
      whereClause
        ? this.db.select({ count: sql<number>`count(*)::int` }).from(elections).where(whereClause)
        : this.db.select({ count: sql<number>`count(*)::int` }).from(elections),
    ]);

    const enriched = await this.enrichElectionsForDisplay(rows, { statements: false });
    return { data: enriched, total: totalRow[0]?.count ?? enriched.length };
  }

  async getElectionResults(id: string, viewer?: ElectionViewer) {
    const [election] = await this.db
      .select({
        results: elections.results,
        status: elections.status,
        config: elections.config,
        method: elections.method,
        createdById: elections.createdById,
      })
      .from(elections)
      .where(eq(elections.id, id))
      .limit(1);

    if (!election) return null;
    if (!this.canViewElection(election, viewer)) return null;

    // Respect sealed results — only show after voting_closed or later
    const config = election.config as ElectionConfig;
    if (config.sealedResults && election.status === 'voting_open') {
      return { sealed: true, status: election.status, results: null };
    }

    // Return the ElectionResults shape inline so the web hook (typed as
    // ElectionResults) can read finalTallies/winners/passed directly.
    // Also include status + a sealed=false flag for callers that care.
    const results = (election.results as ElectionResults | null) ?? null;
    if (!results) {
      return { sealed: false, status: election.status, results: null };
    }
    return {
      ...results,
      sealed: false,
      status: election.status,
    };
  }

  async getTurnout(id: string, viewer?: ElectionViewer) {
    const [election] = await this.db
      .select({
        results: elections.results,
        status: elections.status,
        config: elections.config,
        createdById: elections.createdById,
      })
      .from(elections)
      .where(eq(elections.id, id))
      .limit(1);

    if (!election || !this.canViewElection(election, viewer)) {
      return null;
    }

    const config = election.config as ElectionConfig;
    if (
      viewer
      && !viewer.isStaff
      && election.status === 'voting_open'
      && (config.sealedResults || config.anonymousBallots)
    ) {
      return null;
    }

    const ballotRows = await this.db
      .select({ id: ballots.id })
      .from(ballots)
      .where(eq(ballots.electionId, id));

    const voted = ballotRows.length;
    // Eligible cohort: the snapshot frozen at tally time when there is one;
    // otherwise the characters `getEligibilityForElection` would accept today
    // (registered, alive, inside any faction/party/office filter).
    // `results.turnout` is a *vote count*, so it can't be the denominator.
    // Never report fewer eligible than voted (voters can die after casting),
    // which would push turnout past 100%.
    const snapshot = (election.results as ElectionResults | null)?.eligibleVoters;
    const cohort = typeof snapshot === 'number' ? snapshot : await this.countEligibleVoters(config);
    const eligible = Math.max(cohort, voted);
    const turnoutPct = eligible > 0 ? (voted / eligible) * 100 : 0;

    return {
      electionId: id,
      eligible,
      voted,
      turnoutPct,
      totalBallots: voted, // legacy field — kept for any older consumers
    };
  }

  /**
   * Open votes the viewer could still cast a ballot in: `voting_open`, not
   * past close, and passing the exact `getEligibilityForElection` checks
   * (which include "Already voted"). Soonest-closing first. Reaction-mode
   * votes are included — reaction ballots are rows too, so a reaction clears
   * the item just like a button or web ballot. The default limit is high
   * because the web tags every awaited vote on the Voting list by id; the
   * rows are tiny and the open set has already been loaded to filter it.
   */
  async listAwaitingBallot(viewer: ElectionViewer, limit = 100) {
    const now = new Date();
    const conditions = [eq(elections.status, 'voting_open'), gt(elections.votingClosesAt, now)];
    const visibility = this.visibleElectionCondition(viewer);
    if (visibility) conditions.push(visibility);

    // Every open vote (there are only ever a handful); the limit applies
    // after eligibility, or eligible votes past the first page would vanish.
    const open = await this.db
      .select()
      .from(elections)
      .where(and(...conditions))
      .orderBy(asc(elections.votingClosesAt));
    if (open.length === 0) return { items: [], total: 0 };

    // The same rules as getEligibilityForElection, in a fixed number of
    // queries rather than several per election: this runs on every sidebar
    // poll.
    const [player] = await this.db
      .select({
        characterName: players.characterName,
        factionId: players.factionId,
        partyId: players.partyId,
        isAlive: players.isAlive,
      })
      .from(players)
      .where(eq(players.id, viewer.userId))
      .limit(1);
    if (!player || characterIneligibility(player)) return { items: [], total: 0 };

    const needsOffices = open.some((e) => (e.config as ElectionConfig).eligibleOffices?.length);
    const [votedRows, officeRows] = await Promise.all([
      this.db
        .select({ electionId: ballots.electionId })
        .from(ballots)
        .where(and(eq(ballots.voterId, viewer.userId), inArray(ballots.electionId, open.map((e) => e.id)))),
      needsOffices
        ? this.db
            .select({ officeId: officeHolders.officeId })
            .from(officeHolders)
            .where(and(eq(officeHolders.playerId, viewer.userId), isNull(officeHolders.endDate)))
        : Promise.resolve([] as { officeId: string }[]),
    ]);
    const voted = new Set(votedRows.map((r) => r.electionId));
    const offices = new Set(officeRows.map((r) => r.officeId));

    const awaiting = open.filter((election) => {
      const config = election.config as ElectionConfig;
      if (voted.has(election.id)) return false;
      if (affiliationIneligibility(config, player)) return false;
      if (config.eligibleOffices?.length && !config.eligibleOffices.some((id) => offices.has(id))) return false;
      return true;
    });

    const withSlugs = await this.enrichElectionsWithSlugs(awaiting.slice(0, limit));
    return {
      items: withSlugs.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        method: e.method,
        votingClosesAt: e.votingClosesAt,
        useReactions: e.useReactions,
        relatedBillSlug: e.relatedBillSlug,
      })),
      total: awaiting.length,
    };
  }

  /** Count characters currently eligible under an election's config filters. */
  private async countEligibleVoters(config: ElectionConfig): Promise<number> {
    const conditions = [isNotNull(players.characterName), eq(players.isAlive, true)];
    if (config.eligibleFactions?.length) {
      conditions.push(inArray(players.factionId, config.eligibleFactions));
    }
    if (config.eligibleParties?.length) {
      conditions.push(inArray(players.partyId, config.eligibleParties));
    }
    if (config.eligibleOffices?.length) {
      conditions.push(exists(
        this.db
          .select({ id: officeHolders.id })
          .from(officeHolders)
          .where(and(
            eq(officeHolders.playerId, players.id),
            isNull(officeHolders.endDate),
            inArray(officeHolders.officeId, config.eligibleOffices),
          )),
      ));
    }
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(players)
      .where(and(...conditions));
    return Number(row?.count ?? 0);
  }

  async getEligibility(electionId: string, playerId: string, viewer?: ElectionViewer) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) return { eligible: false, reason: 'Election not found' };
    if (!this.canViewElection(election, viewer)) {
      return { eligible: false, reason: 'Election not found' };
    }
    return this.getEligibilityForElection(election, playerId);
  }

  async getRounds(id: string, viewer?: ElectionViewer) {
    // Get the parent and all child elections (runoff rounds)
    const [parent] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, id))
      .limit(1);

    if (!parent) return [];
    if (!this.canViewElection(parent, viewer)) return [];

    // Get all elections in this chain
    const rootId = parent.parentElectionId ?? parent.id;
    const allRounds = await this.db
      .select()
      .from(elections)
      .where(eq(elections.parentElectionId, rootId))
      .orderBy(elections.roundNumber);

    // Include the root
    if (parent.parentElectionId == null) {
      return [parent, ...allRounds].filter((election) => this.canViewElection(election, viewer));
    }

    // If we were given a child, fetch the root too
    const [root] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, rootId))
      .limit(1);

    return (root ? [root, ...allRounds] : allRounds)
      .filter((election) => this.canViewElection(election, viewer));
  }

  // ----------------------------------------------------------
  // Status transitions
  // ----------------------------------------------------------

  async openVoting(id: string) {
    const [updated] = await this.db
      .update(elections)
      .set({ status: 'voting_open', updatedAt: new Date() })
      .where(eq(elections.id, id))
      .returning();

    return updated ?? null;
  }

  async closeVoting(id: string) {
    const [updated] = await this.db
      .update(elections)
      .set({ status: 'voting_closed', updatedAt: new Date() })
      .where(eq(elections.id, id))
      .returning();

    return updated ?? null;
  }

  // Accepts a loose record (often a raw HTTP body). The writable fields and
  // their coercion are enforced by buildElectionUpdateSet, not by this type, so
  // no caller can mass-assign columns outside the allowlist.
  async updateElection(id: string, data: Record<string, unknown>) {
    const set = buildElectionUpdateSet(data, new Date());

    const [updated] = await this.db
      .update(elections)
      .set(set)
      .where(eq(elections.id, id))
      .returning();

    return updated ?? null;
  }

  // ----------------------------------------------------------
  // Candidates
  // ----------------------------------------------------------

  async registerCandidate(input: RegisterCandidateInput) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, input.electionId))
      .limit(1);

    if (!election) {
      throw new Error('Election not found');
    }

    // Check election accepts nominations
    if (!['draft', 'nominations_open'].includes(election.status)) {
      throw new Error('Nominations are not open for this election');
    }

    // Check not already registered
    const existing = await this.db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.electionId, input.electionId),
          eq(candidates.playerId, input.playerId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new Error('Already registered as a candidate');
    }

    const [player] = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        isAlive: players.isAlive,
        partyId: players.partyId,
      })
      .from(players)
      .where(eq(players.id, input.playerId))
      .limit(1);

    if (!player) {
      throw new Error('Player not found');
    }
    if (!player.characterName) {
      throw new Error('Character registration is required');
    }
    if (!player.isAlive) {
      throw new Error('Dead characters cannot stand as candidates');
    }

    const [candidate] = await this.db
      .insert(candidates)
      .values({
        electionId: input.electionId,
        playerId: input.playerId,
        // Candidates stand under their current party unless a banner was
        // chosen explicitly (null = independent), as `/vote candidate` does.
        partyId: input.partyId === undefined ? (player.partyId ?? null) : input.partyId,
        statement: input.statement ?? null,
        nominatedById: input.nominatedById ?? null,
      })
      .returning();

    return candidate;
  }

  async withdrawCandidate(electionId: string, playerId: string) {
    const [updated] = await this.db
      .update(candidates)
      .set({ isWithdrawn: true })
      .where(
        and(
          eq(candidates.electionId, electionId),
          eq(candidates.playerId, playerId),
        ),
      )
      .returning();

    return updated ?? null;
  }

  async listCandidates(electionId: string) {
    return this.db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.electionId, electionId),
          eq(candidates.isWithdrawn, false),
        ),
      );
  }

  // ----------------------------------------------------------
  // Ballot casting
  // ----------------------------------------------------------

  async castBallot(input: CastBallotInput) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, input.electionId))
      .limit(1);

    if (!election) {
      throw new Error('Election not found');
    }

    if (election.status !== 'voting_open') {
      throw new Error('Voting is not open');
    }
    if (hasVotingCloseTimePassed(election.votingClosesAt)) {
      throw new Error('Voting has closed');
    }

    // Validate ballot format against the election method
    const strategy = getStrategy(election.method as VotingMethod);
    const config = election.config as ElectionConfig;
    if (!strategy.validate(input.vote, config)) {
      throw new Error('Invalid ballot format for this voting method');
    }

    const eligibility = await this.getEligibilityForElection(election, input.voterId);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? 'Not eligible to vote in this election');
    }

    await this.validateCandidateChoices(input.electionId, input.vote);

    // Atomic insert — relies on UNIQUE(election_id, voter_id) to enforce
    // one vote per person per election. Catch 23505 unique_violation and
    // translate to a friendly error.
    try {
      const [ballot] = await this.db
        .insert(ballots)
        .values({
          electionId: input.electionId,
          voterId: input.voterId,
          vote: input.vote,
        })
        .returning();

      return ballot;
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new Error('You have already voted in this election');
      }
      throw err;
    }
  }

  // ----------------------------------------------------------
  // Tallying
  // ----------------------------------------------------------

  async tallyVotes(electionId: string): Promise<ElectionResults> {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      throw new Error('Election not found');
    }

    // Tally must come after the voting window has closed; the bot auto-close
    // worker handles the open -> closed transition. Tallying a still-open
    // election would flip status to `tallied`/`npc_pending`, expose results
    // through the sealed-results gate, and silently halt further ballots.
    if (election.status !== 'voting_closed') {
      throw new Error(
        `Election must be in voting_closed status to tally (currently ${election.status}). Close the vote first.`,
      );
    }

    // Fetch all ballots
    const allBallots = await this.db
      .select({
        id: ballots.id,
        electionId: ballots.electionId,
        voterId: ballots.voterId,
        vote: ballots.vote,
        castAt: ballots.castAt,
      })
      .from(ballots)
      .innerJoin(players, eq(players.id, ballots.voterId))
      .where(and(
        eq(ballots.electionId, electionId),
        eq(players.isAlive, true),
      ));

    // Convert to the Ballot shape expected by strategies
    const strategyBallots = allBallots.map((b) => ({
      id: b.id,
      electionId: b.electionId,
      voterId: b.voterId,
      vote: b.vote as BallotVote,
      castAt: b.castAt.toISOString(),
    }));

    // Run the tally
    const method = election.method as VotingMethod;
    const config = election.config as ElectionConfig;
    const strategy = getStrategy(method);
    const result: TallyResult = strategy.tally(strategyBallots, config);

    // Determine new status
    let newStatus: string = 'tallied';
    if (result.runoffTriggered && config.runoffEnabled !== false) {
      newStatus = 'runoff_needed';
    }

    // Check if NPC confirmation is required
    if (
      newStatus === 'tallied' &&
      config.requiresNpcConfirmation &&
      !result.runoffTriggered
    ) {
      newStatus = 'npc_pending';
    }

    // Freeze the eligible cohort as of the count, so this election's turnout
    // doesn't drift as characters are created, die, or switch party later.
    // Display-only, so a failed count must never block the tally.
    let eligibleVoters: number | undefined;
    try {
      eligibleVoters = await this.countEligibleVoters(config);
    } catch {
      eligibleVoters = undefined;
    }

    // Build results JSONB
    const electionResults: ElectionResults = {
      totalVotes: result.totalVotes,
      turnout: result.turnout,
      eligibleVoters,
      quorumMet: result.quorumMet,
      passed: result.passed,
      rounds: result.rounds,
      finalTallies: result.finalTallies,
      winners: result.winners,
      seatAllocation: result.seatAllocation,
      runoffTriggered: result.runoffTriggered,
    };

    const talliedAt = new Date();

    // Save results, update status, and propagate to any linked legislative
    // bill atomically so we never end up with an election marked tallied
    // while the linked bill is stranded in `voting`.
    await this.db.transaction(async (tx) => {
      await tx
        .update(elections)
        .set({
          results: electionResults,
          status: newStatus,
          updatedAt: talliedAt,
        })
        .where(eq(elections.id, electionId));

      await this.updateRelatedBillAfterTally(tx, election, result, talliedAt);
    });

    return electionResults;
  }

  // ----------------------------------------------------------
  // Runoff creation
  // ----------------------------------------------------------

  async createRunoff(electionId: string) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      throw new Error('Election not found');
    }

    if (election.status !== 'runoff_needed') {
      throw new Error('Election is not in runoff_needed status');
    }

    const results = election.results as ElectionResults | null;
    if (!results) {
      throw new Error('No results to create runoff from');
    }

    const method = election.method as VotingMethod;
    const config = election.config as ElectionConfig;

    // Determine which candidates proceed to the runoff
    let runoffCandidateIds: string[] = [];

    if (method === 'two_round_runoff') {
      runoffCandidateIds = TwoRoundRunoffStrategy.getRunoffCandidates(results);
    } else if (method === 'exhaustive_ballot') {
      // All candidates except the eliminated one
      const eliminated = ExhaustiveBallotStrategy.getEliminatedCandidate(results);
      const currentCandidates = await this.listCandidates(electionId);
      runoffCandidateIds = currentCandidates
        .filter((c) => c.playerId !== eliminated)
        .map((c) => c.playerId);
    } else {
      // For other methods, take the top 2
      const sorted = Object.entries(results.finalTallies).sort((a, b) => b[1] - a[1]);
      runoffCandidateIds = sorted.slice(0, 2).map(([id]) => id);
    }

    // Create the runoff election
    const runoffRound = (election.roundNumber ?? 1) + 1;
    const rootId = election.parentElectionId ?? election.id;

    const [runoff] = await this.db
      .insert(elections)
      .values({
        title: `${election.title} (Round ${runoffRound})`,
        description: election.description,
        type: election.type,
        method: election.method,
        config: election.config,
        requiredPermission: election.requiredPermission,
        forOfficeId: election.forOfficeId,
        parentElectionId: rootId,
        roundNumber: runoffRound,
        votingOpensAt: new Date(), // staff can update
        votingClosesAt: new Date(Date.now() + DEFAULT_VOTE_DURATION_MS),
        createdById: election.createdById,
        discordChannelId: election.discordChannelId,
        status: 'draft',
      })
      .returning();

    // Copy qualifying candidates to the runoff
    if (runoffCandidateIds.length > 0) {
      const originalCandidates = await this.db
        .select()
        .from(candidates)
        .where(
          and(
            eq(candidates.electionId, electionId),
            inArray(candidates.playerId, runoffCandidateIds),
          ),
        );

      if (originalCandidates.length > 0) {
        await this.db.insert(candidates).values(
          originalCandidates.map((c) => ({
            electionId: runoff.id,
            playerId: c.playerId,
            partyId: c.partyId,
            statement: c.statement,
            nominatedById: c.nominatedById,
          })),
        );
      }
    }

    // Update original election with the runoff ID
    await this.db
      .update(elections)
      .set({
        results: {
          ...results,
          runoffElectionId: runoff.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(elections.id, electionId));

    return runoff;
  }

  // ----------------------------------------------------------
  // NPC Confirmation
  // ----------------------------------------------------------

  async enterNpcConfirmation(electionId: string, input: NpcConfirmInput) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      return null;
    }

    const config = election.config as ElectionConfig;
    if (!config.requiresNpcConfirmation) {
      throw new Error('Election does not require NPC confirmation');
    }
    if (election.status !== 'npc_pending') {
      throw new Error('Election is not awaiting NPC confirmation');
    }
    if (!['position_election', 'appointment_confirmation'].includes(election.type)) {
      throw new Error('NPC confirmation is only valid for position elections and appointment confirmations');
    }

    const yea = parseNpcTallyValue(input.yea);
    const nay = parseNpcTallyValue(input.nay);
    const abstain = parseNpcTallyValue(input.abstain);
    const total = yea + nay + abstain;
    const confirmed = yea > nay;

    const npcConfirmation: NpcConfirmation = {
      status: confirmed ? 'confirmed' : 'rejected',
      tally: {
        yea,
        nay,
        abstain,
        total,
      },
      decidedAt: new Date().toISOString(),
      enteredById: input.enteredById,
      notes: input.notes,
    };

    const newStatus = confirmed ? 'tallied' : 'tallied'; // stays tallied, caller certifies

    const [updated] = await this.db
      .update(elections)
      .set({
        npcConfirmation,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(elections.id, electionId))
      .returning();

    return updated ?? null;
  }

  // ----------------------------------------------------------
  // Certification
  // ----------------------------------------------------------

  async certifyElection(electionId: string) {
    const [election] = await this.db
      .select()
      .from(elections)
      .where(eq(elections.id, electionId))
      .limit(1);

    if (!election) {
      throw new Error('Election not found');
    }

    // Certification must come after tally — otherwise `results` is null and
    // any downstream effects (bill transition via updateRelatedBillAfterTally,
    // office appointment) silently skip.
    if (!['tallied', 'npc_pending'].includes(election.status)) {
      throw new Error(
        `Election must be tallied before certification (currently ${election.status}). Run tally first.`,
      );
    }

    const config = election.config as ElectionConfig;

    // If NPC confirmation is required, check it's been done
    if (config.requiresNpcConfirmation) {
      const npc = election.npcConfirmation as NpcConfirmation | null;
      if (!npc || npc.status === 'pending') {
        throw new Error('NPC confirmation is still pending');
      }
      if (npc.status === 'rejected') {
        throw new Error('NPC house rejected this election result');
      }
    }

    // Position elections require a winner before certification — otherwise
    // we'd flip status to `certified` and silently skip the appointment,
    // leaving the office vacant with no way to recover via the normal flow.
    const isAppointingPositionElection =
      election.type === 'position_election' && !!election.forOfficeId;
    const results = election.results as ElectionResults | null;
    if (isAppointingPositionElection) {
      const winners = results?.winners ?? [];
      if (winners.length === 0) {
        throw new Error(
          'Cannot certify a position election with no winner — re-run the tally or cancel the election.',
        );
      }
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(elections)
        .set({ status: 'certified', updatedAt: new Date() })
        .where(eq(elections.id, electionId))
        .returning();

      if (row && isAppointingPositionElection && election.forOfficeId) {
        const winners = results?.winners ?? [];
        const winnerId = winners[0];
        if (winnerId) {
          await appointToOffice(tx, election.forOfficeId, winnerId, election.createdById);
        }
      }

      return row ?? null;
    });

    return updated;
  }
}
