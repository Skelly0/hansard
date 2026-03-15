import type {
  ElectionStatus,
  ElectionType,
  VotingMethod,
  MajorityType,
} from '../constants/statuses.js';

// ============================================================
// Ballot Vote — discriminated union matching the DB JSONB type
// ============================================================

export type BallotVote =
  | { type: 'fptp'; candidateId: string }
  | { type: 'ranked'; ranking: string[] }
  | { type: 'approval'; approved: string[] }
  | { type: 'yea_nay'; choice: 'yea' | 'nay' | 'abstain' }
  | { type: 'two_round'; candidateId: string }
  | { type: 'exhaustive'; candidateId: string };

// ============================================================
// Election Config (JSONB on elections table)
// ============================================================

export interface ElectionConfig {
  // Majority & threshold
  quorumRequired?: number;
  quorumType?: 'absolute' | 'percentage';
  passThreshold?: number;
  majorityType?: MajorityType;

  // Candidate elections
  seatsAvailable?: number;
  maxChoices?: number;

  // Runoff config
  runoffEnabled?: boolean;
  runoffMethod?: 'top_two' | 'exhaustive' | 'instant';
  runoffThreshold?: number;

  // Proportional
  proportionalMethod?: 'dhondt' | 'sainte_lague' | 'hare';

  // Visibility
  sealedResults?: boolean;
  anonymousBallots?: boolean;

  // Eligibility
  eligibleFactions?: string[];
  eligibleParties?: string[];
  eligibleOffices?: string[];
  requireRegistration?: boolean;

  // NPC house confirmation
  requiresNpcConfirmation?: boolean;
}

// ============================================================
// NPC Confirmation (JSONB on elections table)
// ============================================================

export interface NpcConfirmation {
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
}

// ============================================================
// Election Results (JSONB on elections table)
// ============================================================

export interface ElectionRound {
  round: number;
  tallies: Record<string, number>;
  eliminated?: string;
}

export interface ElectionResults {
  totalVotes: number;
  turnout: number;
  quorumMet?: boolean;
  passed?: boolean;
  rounds?: ElectionRound[];
  finalTallies: Record<string, number>;
  winners?: string[];
  seatAllocation?: Record<string, number>;
  runoffTriggered?: boolean;
  runoffElectionId?: string;
}

// ============================================================
// Tally Result — output of a tallying strategy
// ============================================================

export interface TallyResult {
  totalVotes: number;
  turnout: number;
  quorumMet?: boolean;
  passed?: boolean;
  rounds?: ElectionRound[];
  finalTallies: Record<string, number>;
  winners?: string[];
  seatAllocation?: Record<string, number>;
  runoffTriggered?: boolean;
}

// ============================================================
// Tally Strategy — strategy pattern interface for vote tallying
// ============================================================

export interface Ballot {
  id: string;
  electionId: string;
  voterId: string;
  vote: BallotVote;
  castAt: string;
}

export interface TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult;
  validate(ballot: BallotVote, config: ElectionConfig): boolean;
  /** For methods that support it, check if a runoff is needed */
  needsRunoff?(result: TallyResult, config: ElectionConfig): boolean;
}

// ============================================================
// Election — the full shape returned by API
// ============================================================

export interface Election {
  id: string;
  title: string;
  description: string | null;
  type: ElectionType;
  method: VotingMethod;
  requiredPermission: string | null;
  config: ElectionConfig;
  forOfficeId: string | null;
  npcConfirmation: NpcConfirmation | null;
  parentElectionId: string | null;
  roundNumber: number;
  nominationsOpenAt: string | null;
  nominationsCloseAt: string | null;
  votingOpensAt: string;
  votingClosesAt: string;
  status: ElectionStatus;
  results: ElectionResults | null;
  relatedBillId: string | null;
  createdById: string;
  discordMessageId: string | null;
  discordChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Candidate
// ============================================================

export interface Candidate {
  id: string;
  electionId: string;
  playerId: string;
  partyId: string | null;
  statement: string | null;
  nominatedById: string | null;
  isWithdrawn: boolean;
  registeredAt: string;
}
