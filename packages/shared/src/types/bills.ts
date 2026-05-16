import type { BillStatus, DocumentType } from '../constants/statuses.js';

// ============================================================
// NPC Vote (JSONB on bills table)
// ============================================================

export interface NpcVoteTally {
  yea: number;
  nay: number;
  abstain: number;
  total: number;
}

export interface NpcVote {
  status: 'pending' | 'passed' | 'rejected' | 'amended';
  tally?: NpcVoteTally;
  amendmentNotes?: string;
  decidedAt?: string;
  enteredById?: string;
  notes?: string;
}

// ============================================================
// Estimated Effects (JSONB on bills table)
// ============================================================

export interface EstimatedEffects {
  economy?: {
    description: string;
    affectedSectors?: string[];
    estimatedGdpImpact?: string;
    rawModifiers?: Record<string, number>;
  };
  popsim?: {
    description: string;
    affectedGroups?: string[];
    estimatedApprovalImpact?: string;
    rawModifiers?: Record<string, number>;
  };
  notes?: string;
}

export interface BillPlayerSummary {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

export type BillType = 'google_doc' | 'short';

// ============================================================
// Bill — the full shape returned by API
// ============================================================

export interface Bill {
  id: string;
  title: string;
  shortTitle: string | null;
  slug: string;
  billNumber: number;
  billType: BillType;

  // Source
  googleDocUrl: string | null;
  googleDocId: string | null;

  // Cached content, or authoritative text for short bills
  cachedContent: string | null;
  cachedAt: string | null;
  summary: string | null;

  // Authorship
  authorId: string;
  author?: BillPlayerSummary;
  submittedById: string;
  submittedBy?: BillPlayerSummary;
  coSponsorIds: string[];
  coSponsors?: BillPlayerSummary[];

  // Status
  status: BillStatus;
  submittedAt: string;

  // Player house vote
  playerVoteId: string | null;
  playerVoteResult: string | null;
  playerVoteAt: string | null;

  // NPC house vote
  npcVoteRequired: boolean;
  npcVote: NpcVote | null;

  // Final outcome
  enactedAt: string | null;
  effectiveAt: string | null;
  repealedAt: string | null;
  repealedByBillId: string | null;

  // Collection & hierarchy
  collectionId: string | null;
  parentDocumentId: string | null;
  amendsBillId: string | null;
  amendsBillSlug: string | null;
  amendsDocumentId: string | null;
  amendsDocumentSlug: string | null;

  // Classification
  tags: string[];
  policyAreas: string[];
  crossReferences: string[];

  // Effects
  estimatedEffects: EstimatedEffects | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Bill Status Log Entry
// ============================================================

export interface BillStatusLogEntry {
  id: string;
  billId: string;
  fromStatus: string | null;
  toStatus: string;
  changedById: string;
  notes: string | null;
  simTick: number | null;
  simDate: string | null;
  createdAt: string;
}

// ============================================================
// Document Collection
// ============================================================

export interface DocumentCollection {
  id: string;
  name: string;
  type: DocumentType;
  description: string | null;
  sortOrder: number;
  isPublic: boolean;
}

// ============================================================
// Static Document (non-legislative)
// ============================================================

export interface Document {
  id: string;
  collectionId: string;
  title: string;
  slug: string;
  content: string | null;
  googleDocUrl: string | null;
  cachedContent: string | null;
  cachedAt: string | null;
  parentDocumentId: string | null;
  hierarchyLevel: number;
  currentVersion: number;
  authorId: string | null;
  accessLevel: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Document Version
// ============================================================

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  changeDescription: string | null;
  editedById: string;
  amendmentBillId: string | null;
  createdAt: string;
}
