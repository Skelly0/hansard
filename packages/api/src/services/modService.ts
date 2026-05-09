import { eq, and, desc, count, type SQL } from 'drizzle-orm';
import {
  modActions,
  modNotes,
  players,
  type Database,
} from '@hansard/db';
import type { ModAction, ModNote } from '@hansard/shared';
import type { ModActionType, AppealStatus } from '@hansard/shared';

// ============================================================
// Types for service inputs
// ============================================================

export interface CreateActionInput {
  targetPlayerId: string;
  moderatorId: string;
  type: ModActionType;
  reason: string;
  internalNotes?: string;
  expiresAt?: Date;
  ticketId?: string;
}

export interface UpdateActionInput {
  isActive?: boolean;
  expiresAt?: Date | null;
  appealStatus?: AppealStatus;
  appealReason?: string;
  appealReviewedById?: string;
  internalNotes?: string;
}

export interface ListActionsFilters {
  type?: ModActionType;
  isActive?: boolean;
  targetPlayerId?: string;
  moderatorId?: string;
  limit?: number;
  offset?: number;
}

export interface AddNoteInput {
  targetPlayerId: string;
  authorId: string;
  content: string;
}

function actionListConditions(filters: ListActionsFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.type !== undefined) {
    conditions.push(eq(modActions.type, filters.type));
  }
  if (filters.isActive !== undefined) {
    conditions.push(eq(modActions.isActive, filters.isActive));
  }
  if (filters.targetPlayerId !== undefined) {
    conditions.push(eq(modActions.targetPlayerId, filters.targetPlayerId));
  }
  if (filters.moderatorId !== undefined) {
    conditions.push(eq(modActions.moderatorId, filters.moderatorId));
  }

  return conditions;
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Create a new mod action (warn, mute, suspend, ban).
 */
export async function createAction(db: Database, data: CreateActionInput): Promise<ModAction> {
  const [action] = await db.insert(modActions).values({
    targetPlayerId: data.targetPlayerId,
    moderatorId: data.moderatorId,
    type: data.type,
    reason: data.reason,
    internalNotes: data.internalNotes ?? null,
    expiresAt: data.expiresAt ?? null,
    ticketId: data.ticketId ?? null,
    isActive: true,
    appealStatus: null,
    appealReason: null,
    appealReviewedById: null,
  }).returning();

  return toModAction(action);
}

/**
 * Get a single mod action by ID.
 */
export async function getAction(db: Database, id: string): Promise<ModAction | null> {
  const [action] = await db
    .select()
    .from(modActions)
    .where(eq(modActions.id, id))
    .limit(1);

  if (!action) return null;
  return toModAction(action);
}

/**
 * Get full mod history for a player — all actions and notes.
 */
export async function getPlayerModHistory(
  db: Database,
  playerId: string,
): Promise<{ actions: ModAction[]; notes: ModNote[] }> {
  const actions = await db
    .select()
    .from(modActions)
    .where(eq(modActions.targetPlayerId, playerId))
    .orderBy(desc(modActions.createdAt));

  const notes = await db
    .select()
    .from(modNotes)
    .where(eq(modNotes.targetPlayerId, playerId))
    .orderBy(desc(modNotes.createdAt));

  return {
    actions: actions.map(toModAction),
    notes: notes.map(toModNote),
  };
}

/**
 * Update a mod action — expire early, set appeal decision, edit notes.
 */
export async function updateAction(
  db: Database,
  id: string,
  updates: UpdateActionInput,
): Promise<ModAction | null> {
  const existing = await getAction(db, id);
  if (!existing) return null;

  const setValues: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.isActive !== undefined) {
    setValues.isActive = updates.isActive;
  }
  if (updates.expiresAt !== undefined) {
    setValues.expiresAt = updates.expiresAt;
  }
  if (updates.appealStatus !== undefined) {
    setValues.appealStatus = updates.appealStatus;
  }
  if (updates.appealReason !== undefined) {
    setValues.appealReason = updates.appealReason;
  }
  if (updates.appealReviewedById !== undefined) {
    setValues.appealReviewedById = updates.appealReviewedById;
  }
  if (updates.internalNotes !== undefined) {
    setValues.internalNotes = updates.internalNotes;
  }

  const [updated] = await db
    .update(modActions)
    .set(setValues)
    .where(eq(modActions.id, id))
    .returning();

  return toModAction(updated);
}

/**
 * Add a staff note to a player.
 */
export async function addNote(db: Database, data: AddNoteInput): Promise<ModNote> {
  const [note] = await db.insert(modNotes).values({
    targetPlayerId: data.targetPlayerId,
    authorId: data.authorId,
    content: data.content,
  }).returning();

  return toModNote(note);
}

/**
 * List mod actions with optional filters.
 */
export async function listActions(
  db: Database,
  filters: ListActionsFilters = {},
): Promise<ModAction[]> {
  const conditions = actionListConditions(filters);
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select()
    .from(modActions)
    .where(whereClause)
    .orderBy(desc(modActions.createdAt))
    .limit(limit)
    .offset(offset);

  return results.map(toModAction);
}

export async function countActions(
  db: Database,
  filters: ListActionsFilters = {},
): Promise<number> {
  const conditions = actionListConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [row] = await db
    .select({ value: count() })
    .from(modActions)
    .where(whereClause);

  return row?.value ?? 0;
}

/**
 * Get moderation activity stats — counts by type, active actions total.
 */
export async function getStats(db: Database): Promise<{
  totalActions: number;
  activeActions: number;
  byType: Record<string, number>;
  recentActions: ModAction[];
}> {
  // Total actions
  const [totalResult] = await db
    .select({ value: count() })
    .from(modActions);
  const totalActions = totalResult?.value ?? 0;

  // Active actions
  const [activeResult] = await db
    .select({ value: count() })
    .from(modActions)
    .where(eq(modActions.isActive, true));
  const activeActions = activeResult?.value ?? 0;

  // All actions for counting by type
  const allActions = await db
    .select({ type: modActions.type })
    .from(modActions);

  const byType: Record<string, number> = {};
  for (const a of allActions) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  // Recent 10 actions
  const recent = await db
    .select()
    .from(modActions)
    .orderBy(desc(modActions.createdAt))
    .limit(10);

  return {
    totalActions,
    activeActions,
    byType,
    recentActions: recent.map(toModAction),
  };
}

// ============================================================
// Mappers
// ============================================================

function toModAction(row: typeof modActions.$inferSelect): ModAction {
  return {
    id: row.id,
    targetPlayerId: row.targetPlayerId,
    moderatorId: row.moderatorId,
    type: row.type as ModAction['type'],
    reason: row.reason,
    internalNotes: row.internalNotes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    isActive: row.isActive,
    appealStatus: (row.appealStatus as ModAction['appealStatus']) ?? null,
    appealReason: row.appealReason ?? null,
    appealReviewedById: row.appealReviewedById ?? null,
    ticketId: row.ticketId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toModNote(row: typeof modNotes.$inferSelect): ModNote {
  return {
    id: row.id,
    targetPlayerId: row.targetPlayerId,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
