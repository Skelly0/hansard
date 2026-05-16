import type { FavourTransactionType } from '../constants/statuses.js';

// ============================================================
// Favour Category
// ============================================================

export interface FavourCategory {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  emoji: string | null;
  colour: string | null;
  spendableOn: string[] | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

// ============================================================
// Favour Balance (denormalised per player per category)
// ============================================================

export interface FavourBalance {
  id: string;
  playerId: string;
  categoryId: string;
  balance: number;
  updatedAt: string;
}

// ============================================================
// Favour Transaction
// ============================================================

export interface FavourTransaction {
  id: string;
  playerId: string;
  categoryId: string;
  amount: number;
  balanceAfter: number;
  type: FavourTransactionType;
  reason: string | null;
  grantedById: string | null;
  simTick: number | null;
  simDate: string | null;
  createdAt: string;
}
