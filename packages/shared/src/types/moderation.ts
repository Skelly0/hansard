import type { ModActionType } from '../constants/statuses.js';

// ============================================================
// Appeal Status
// ============================================================

export const AppealStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DENIED: 'denied',
} as const;
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];

// ============================================================
// Mod Action
// ============================================================

export interface ModAction {
  id: string;
  targetPlayerId: string;
  moderatorId: string;
  type: ModActionType;
  reason: string;
  internalNotes: string | null;
  expiresAt: string | null;
  isActive: boolean;
  appealStatus: AppealStatus | null;
  appealReason: string | null;
  appealReviewedById: string | null;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Mod Note
// ============================================================

export interface ModNote {
  id: string;
  targetPlayerId: string;
  authorId: string;
  content: string;
  createdAt: string;
}
