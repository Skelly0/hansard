// ============================================================
// Status Enums — as const objects + derived union types
// ============================================================

// --- Bill Lifecycle ---
export const BillStatus = {
  SUBMITTED: 'submitted',
  WITHDRAWN: 'withdrawn',
  VOTING: 'voting',
  PLAYER_PASSED: 'player_passed',
  PLAYER_REJECTED: 'player_rejected',
  NPC_PENDING: 'npc_pending',
  NPC_PASSED: 'npc_passed',
  NPC_REJECTED: 'npc_rejected',
  ENACTED: 'enacted',
  ACTIVE: 'active',
  AMENDED: 'amended',
  REPEALED: 'repealed',
} as const;
export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

// --- Tickets ---
export const TicketStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING: 'waiting',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

// --- Elections ---
export const ElectionStatus = {
  DRAFT: 'draft',
  NOMINATIONS_OPEN: 'nominations_open',
  NOMINATIONS_CLOSED: 'nominations_closed',
  VOTING_OPEN: 'voting_open',
  VOTING_CLOSED: 'voting_closed',
  TALLIED: 'tallied',
  RUNOFF_NEEDED: 'runoff_needed',
  NPC_PENDING: 'npc_pending',
  CERTIFIED: 'certified',
  CANCELLED: 'cancelled',
} as const;
export type ElectionStatus = (typeof ElectionStatus)[keyof typeof ElectionStatus];

export const ElectionType = {
  LEGISLATIVE_VOTE: 'legislative_vote',
  POSITION_ELECTION: 'position_election',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  GENERAL_ELECTION: 'general_election',
  PARTY_PRIMARY: 'party_primary',
  REFERENDUM: 'referendum',
  CONFIDENCE_VOTE: 'confidence_vote',
  CONSTITUTIONAL_AMENDMENT: 'constitutional_amendment',
  CUSTOM: 'custom',
} as const;
export type ElectionType = (typeof ElectionType)[keyof typeof ElectionType];

export const VotingMethod = {
  FPTP: 'fptp',
  RANKED_CHOICE: 'ranked_choice',
  STV: 'stv',
  APPROVAL: 'approval',
  PROPORTIONAL: 'proportional',
  YEA_NAY_ABSTAIN: 'yea_nay_abstain',
  TWO_ROUND_RUNOFF: 'two_round_runoff',
  EXHAUSTIVE_BALLOT: 'exhaustive_ballot',
} as const;
export type VotingMethod = (typeof VotingMethod)[keyof typeof VotingMethod];

export const MajorityType = {
  SIMPLE: 'simple',
  ABSOLUTE: 'absolute',
  SUPERMAJORITY: 'supermajority',
  QUALIFIED: 'qualified',
  UNANIMOUS: 'unanimous',
} as const;
export type MajorityType = (typeof MajorityType)[keyof typeof MajorityType];

// --- Player Health ---
export const HealthStatus = {
  HEALTHY: 'healthy',
  MINOR: 'minor',
  MAJOR: 'major',
  CRITICAL: 'critical',
} as const;
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

export const AilmentSeverity = {
  MINOR: 'minor',
  MAJOR: 'major',
  CRITICAL: 'critical',
} as const;
export type AilmentSeverity = (typeof AilmentSeverity)[keyof typeof AilmentSeverity];

// --- Moderation ---
export const ModActionType = {
  NOTE: 'note',
  VERBAL_WARNING: 'verbal_warning',
  FORMAL_WARNING: 'formal_warning',
  MUTE: 'mute',
  TEMPORARY_SUSPENSION: 'temporary_suspension',
  PERMANENT_BAN: 'permanent_ban',
} as const;
export type ModActionType = (typeof ModActionType)[keyof typeof ModActionType];

// --- Offices ---
export const OfficeTier = {
  HEAD_OF_STATE: 'head_of_state',
  HEAD_OF_GOVERNMENT: 'head_of_government',
  CABINET: 'cabinet',
  LEGISLATURE: 'legislature',
  REGIONAL: 'regional',
} as const;
export type OfficeTier = (typeof OfficeTier)[keyof typeof OfficeTier];

export const OfficeFilledBy = {
  ELECTED: 'elected',
  APPOINTED: 'appointed',
  SUCCESSION: 'succession',
  STAFF: 'staff',
} as const;
export type OfficeFilledBy = (typeof OfficeFilledBy)[keyof typeof OfficeFilledBy];

export const AppointmentMethod = {
  ELECTED: 'elected',
  APPOINTED: 'appointed',
  SUCCESSION: 'succession',
  STAFF_ASSIGNED: 'staff_assigned',
} as const;
export type AppointmentMethod = (typeof AppointmentMethod)[keyof typeof AppointmentMethod];

// --- Favours ---
export const FavourTransactionType = {
  GRANT: 'grant',
  SPEND: 'spend',
  REMOVE: 'remove',
  TRANSFER: 'transfer',
  SYSTEM: 'system',
} as const;
export type FavourTransactionType = (typeof FavourTransactionType)[keyof typeof FavourTransactionType];

// --- Player Events ---
export const PlayerEventType = {
  PARTY_CHANGE: 'party_change',
  FACTION_CHANGE: 'faction_change',
  OFFICE_APPOINTED: 'office_appointed',
  OFFICE_LEFT: 'office_left',
  AILMENT_ACQUIRED: 'ailment_acquired',
  AILMENT_RECOVERED: 'ailment_recovered',
  HEALTH_CHANGED: 'health_changed',
  DEATH_PENDING: 'death_pending',
  DEATH: 'death',
  REGISTRATION: 'registration',
  REINCARNATION: 'reincarnation',
  NAME_CHANGE: 'name_change',
  SUSPENSION: 'suspension',
  UNSUSPENSION: 'unsuspension',
} as const;
export type PlayerEventType = (typeof PlayerEventType)[keyof typeof PlayerEventType];

// --- Documents ---
export const DocumentType = {
  LEGISLATION: 'legislation',
  WORLDBUILDING: 'worldbuilding',
  REFERENCE: 'reference',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

// --- Reaction-mode voting ---
// Emoji → ballot value mapping for reaction-based public votes.
// Used by both vote creation (to seed reactions on the embed) and the
// MessageReactionAdd handler (to translate a click back into a ballot).
//
// Methods supported:
//   - yea_nay_abstain: 3 reactions (yea / nay / abstain)
//   - fptp: 1..9 number reactions, indexed against candidates by registration order
//
// Other methods (ranked_choice, stv, approval, two_round_runoff, exhaustive_ballot,
// proportional) cannot fit reactions and must remain button-mode.
export const REACTION_EMOJI = {
  YEA: '👍',       // 👍
  NAY: '👎',       // 👎
  ABSTAIN: '🤐',   // 🤐 (zipper-mouth — distinct from yea/nay)
} as const;

/** Candidate-position emojis for FPTP reaction mode (positions 1..9). */
export const REACTION_CANDIDATE_EMOJIS = [
  '1️⃣', // 1️⃣
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
] as const;

/** Voting methods compatible with reaction mode. */
export const REACTION_COMPATIBLE_METHODS = ['yea_nay_abstain', 'fptp'] as const;
export type ReactionCompatibleMethod = (typeof REACTION_COMPATIBLE_METHODS)[number];

/** Hard cap on FPTP candidates for reaction mode (Discord caps reactions at 20 but UX falls apart well before that). */
export const REACTION_FPTP_MAX_CANDIDATES = 9;
