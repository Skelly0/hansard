import { eq, and, desc, asc, gte, sql, type SQL } from 'drizzle-orm';
import {
  favourCategories,
  favourBalances,
  favourTransactions,
  players,
  factions,
  type Database,
} from '@hansard/db';
import type { FavourCategory, FavourBalance, FavourTransaction } from '@hansard/shared';
import { FavourTransactionType } from '@hansard/shared';

// ============================================================
// Types for service inputs
// ============================================================

export interface CreateCategoryInput {
  name: string;
  shortName?: string;
  description?: string;
  emoji?: string;
  colour?: string;
  spendableOn?: string[];
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  shortName?: string | null;
  description?: string | null;
  emoji?: string | null;
  colour?: string | null;
  spendableOn?: string[] | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface PlayerBalanceRow extends FavourBalance {
  categoryName: string;
  categoryEmoji: string | null;
}

export interface LeaderboardEntry {
  playerId: string;
  playerName: string | null;
  discordUsername: string;
  balance: number;
}

export interface TransactionFilters {
  categoryId?: string;
  playerId?: string;
  grantedById?: string;
  type?: FavourTransactionType;
  limit?: number;
  offset?: number;
}

export interface StartingFactionFavourGrant {
  categoryId: string;
  categoryName: string;
  amount: number;
  balanceAfter: number;
}

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// ============================================================
// Category Functions
// ============================================================

/**
 * List favour categories. By default only active ones; pass
 * `{ includeInactive: true }` to surface deactivated categories
 * (used by the staff "Manage categories" admin UI).
 */
export async function getCategories(
  db: Database,
  options: { includeInactive?: boolean } = {},
): Promise<FavourCategory[]> {
  const base = db.select().from(favourCategories);
  const rows = options.includeInactive
    ? await base.orderBy(asc(favourCategories.sortOrder), asc(favourCategories.name))
    : await base
        .where(eq(favourCategories.isActive, true))
        .orderBy(asc(favourCategories.sortOrder), asc(favourCategories.name));

  return rows.map(toCategory);
}

/**
 * Create a new favour category (staff only).
 */
export async function createCategory(db: Database, data: CreateCategoryInput): Promise<FavourCategory> {
  const [category] = await db.insert(favourCategories).values({
    name: data.name,
    shortName: data.shortName ?? null,
    description: data.description ?? null,
    emoji: data.emoji ?? null,
    colour: data.colour ?? null,
    spendableOn: data.spendableOn ?? null,
    sortOrder: data.sortOrder ?? 0,
    isActive: true,
  }).returning();

  return toCategory(category);
}

/**
 * Update a favour category (staff only).
 */
export async function updateCategory(
  db: Database,
  id: string,
  data: UpdateCategoryInput,
): Promise<FavourCategory | null> {
  const [existing] = await db
    .select()
    .from(favourCategories)
    .where(eq(favourCategories.id, id))
    .limit(1);

  if (!existing) return null;

  const updates: Record<string, unknown> = {};

  if (data.name !== undefined) updates.name = data.name;
  if (data.shortName !== undefined) updates.shortName = data.shortName;
  if (data.description !== undefined) updates.description = data.description;
  if (data.emoji !== undefined) updates.emoji = data.emoji;
  if (data.colour !== undefined) updates.colour = data.colour;
  if (data.spendableOn !== undefined) updates.spendableOn = data.spendableOn;
  if (data.isActive !== undefined) updates.isActive = data.isActive;
  if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

  if (Object.keys(updates).length === 0) {
    return toCategory(existing);
  }

  const [updated] = await db
    .update(favourCategories)
    .set(updates)
    .where(eq(favourCategories.id, id))
    .returning();

  return toCategory(updated);
}

// ============================================================
// Balance Functions
// ============================================================

/**
 * Get all favour balances for a single player, with category info.
 */
export async function getPlayerBalances(db: Database, playerId: string): Promise<PlayerBalanceRow[]> {
  const rows = await db
    .select({
      balance: favourBalances,
      categoryName: favourCategories.name,
      categoryEmoji: favourCategories.emoji,
    })
    .from(favourBalances)
    .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
    .where(eq(favourBalances.playerId, playerId))
    .orderBy(asc(favourCategories.sortOrder));

  return rows.map((r) => ({
    ...toBalance(r.balance),
    categoryName: r.categoryName,
    categoryEmoji: r.categoryEmoji,
  }));
}

/**
 * Get all players' balances (staff overview).
 */
export async function getAllBalances(db: Database): Promise<(FavourBalance & { playerName: string | null; discordUsername: string; categoryName: string })[]> {
  const rows = await db
    .select({
      balance: favourBalances,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
      categoryName: favourCategories.name,
    })
    .from(favourBalances)
    .innerJoin(players, eq(favourBalances.playerId, players.id))
    .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
    .orderBy(asc(players.characterName), asc(favourCategories.sortOrder));

  return rows.map((r) => ({
    ...toBalance(r.balance),
    playerName: r.playerName,
    discordUsername: r.discordUsername,
    categoryName: r.categoryName,
  }));
}

/**
 * Get the leaderboard (top players) for a specific category.
 */
export async function getLeaderboard(
  db: Database,
  categoryId: string,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      playerId: favourBalances.playerId,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
      balance: favourBalances.balance,
    })
    .from(favourBalances)
    .innerJoin(players, eq(favourBalances.playerId, players.id))
    .where(eq(favourBalances.categoryId, categoryId))
    .orderBy(desc(favourBalances.balance))
    .limit(limit);

  return rows;
}

// ============================================================
// Starting Faction Favour Grants
// ============================================================

function normaliseLabel(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return cleaned ? cleaned : null;
}

function categoryMatchesFaction(
  category: typeof favourCategories.$inferSelect,
  faction: typeof factions.$inferSelect,
): boolean {
  const factionLabels = new Set(
    [normaliseLabel(faction.name), normaliseLabel(faction.shortName)].filter((label): label is string => Boolean(label)),
  );

  return [normaliseLabel(category.name), normaliseLabel(category.shortName)]
    .some((label) => label !== null && factionLabels.has(label));
}

/**
 * Apply the starting-age favour bonus to the favour category that corresponds
 * to the selected faction. The correspondence is intentionally conservative:
 * an active category must exactly match the faction's name or short name.
 */
export async function grantStartingFactionFavours(
  db: DbOrTx,
  playerId: string,
  factionId: string | null | undefined,
  amount: number,
): Promise<StartingFactionFavourGrant | null> {
  if (amount <= 0 || !factionId) {
    return null;
  }

  const [faction] = await db
    .select()
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  if (!faction) {
    return null;
  }

  const activeCategories = await db
    .select()
    .from(favourCategories)
    .where(eq(favourCategories.isActive, true));

  const category = activeCategories.find((candidate) => categoryMatchesFaction(candidate, faction));
  if (!category) {
    return null;
  }

  const [updatedRow] = await db
    .insert(favourBalances)
    .values({
      playerId,
      categoryId: category.id,
      balance: amount,
    })
    .onConflictDoUpdate({
      target: [favourBalances.playerId, favourBalances.categoryId],
      set: {
        balance: sql`${favourBalances.balance} + ${amount}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const balanceAfter = updatedRow.balance;

  await db.insert(favourTransactions).values({
    playerId,
    categoryId: category.id,
    amount,
    balanceAfter,
    type: FavourTransactionType.SYSTEM,
    reason: `Starting age favour bonus for joining ${faction.name}`,
    grantedById: null,
  }).returning();

  return {
    categoryId: category.id,
    categoryName: category.name,
    amount,
    balanceAfter,
  };
}

// ============================================================
// Transaction Functions
// ============================================================

/**
 * Internal helper: ensure a balance row exists, then apply a delta.
 * Returns the new balance after the transaction.
 *
 * The entire balance mutation + transaction-log insert runs inside a single
 * `db.transaction` so concurrent spenders cannot race. For deductions
 * (`amount < 0`) we use a conditional UPDATE that requires the existing
 * balance to be >= the deduction; if no row matches we fall back to a SELECT
 * to build a clear "insufficient funds" error. This mirrors the bot's
 * `commands/favours/spend.ts` pattern documented in CLAUDE.md:
 * "Spend uses a conditional UPDATE (`gte(balance, amount)`) to enforce
 * sufficient funds in a single statement."
 */
async function applyTransaction(
  db: Database,
  playerId: string,
  categoryId: string,
  amount: number,
  type: FavourTransactionType,
  reason: string | null,
  grantedById: string | null,
): Promise<FavourTransaction> {
  // Verify player exists
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  // Verify category exists and is active
  const [category] = await db
    .select()
    .from(favourCategories)
    .where(eq(favourCategories.id, categoryId))
    .limit(1);

  if (!category) {
    throw new Error(`Favour category not found: ${categoryId}`);
  }

  if (!category.isActive) {
    throw new Error(`Favour category "${category.name}" is not active`);
  }

  return db.transaction(async (tx) => {
    let newBalance: number;

    if (amount < 0) {
      // Spend / remove — atomic conditional decrement.
      const deduction = -amount;
      const [updated] = await tx
        .update(favourBalances)
        .set({
          balance: sql`${favourBalances.balance} - ${deduction}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(favourBalances.playerId, playerId),
            eq(favourBalances.categoryId, categoryId),
            gte(favourBalances.balance, deduction),
          ),
        )
        .returning({ balance: favourBalances.balance });

      if (!updated) {
        // Either no balance row at all or insufficient funds — read current
        // balance for a clear error message. Throwing inside the transaction
        // callback rolls back any work, but since the conditional UPDATE
        // matched zero rows there is nothing to roll back here anyway.
        const [existing] = await tx
          .select({ balance: favourBalances.balance })
          .from(favourBalances)
          .where(
            and(
              eq(favourBalances.playerId, playerId),
              eq(favourBalances.categoryId, categoryId),
            ),
          )
          .limit(1);
        const currentBalance = existing?.balance ?? 0;
        throw new Error(
          `Insufficient favours: ${player.characterName ?? player.discordUsername} has ${currentBalance} in ${category.name}, cannot deduct ${deduction}`,
        );
      }

      newBalance = updated.balance;
    } else {
      // Grant — atomic insert-or-update on (playerId, categoryId).
      // Relies on UNIQUE(player_id, category_id) being present.
      const [updatedRow] = await tx
        .insert(favourBalances)
        .values({
          playerId,
          categoryId,
          balance: amount,
        })
        .onConflictDoUpdate({
          target: [favourBalances.playerId, favourBalances.categoryId],
          set: {
            balance: sql`${favourBalances.balance} + ${amount}`,
            updatedAt: new Date(),
          },
        })
        .returning();

      newBalance = updatedRow.balance;
    }

    // Log the transaction in the same db.transaction so a partial state can
    // never strand a balance change without its audit row, and vice versa.
    const [transaction] = await tx.insert(favourTransactions).values({
      playerId,
      categoryId,
      amount,
      balanceAfter: newBalance,
      type,
      reason,
      grantedById,
    }).returning();

    return toTransaction(transaction);
  });
}

/**
 * Grant favours to a player (positive amount).
 */
export async function grantFavours(
  db: Database,
  playerId: string,
  categoryId: string,
  amount: number,
  reason: string | null,
  grantedById: string,
): Promise<FavourTransaction> {
  if (amount <= 0) {
    throw new Error('Grant amount must be positive');
  }

  return applyTransaction(
    db,
    playerId,
    categoryId,
    amount,
    FavourTransactionType.GRANT,
    reason,
    grantedById,
  );
}

/**
 * Spend favours for a player (deducts from balance).
 */
export async function spendFavours(
  db: Database,
  playerId: string,
  categoryId: string,
  amount: number,
  reason: string | null,
  grantedById: string,
): Promise<FavourTransaction> {
  if (amount <= 0) {
    throw new Error('Spend amount must be positive');
  }

  return applyTransaction(
    db,
    playerId,
    categoryId,
    -amount, // negative for deduction
    FavourTransactionType.SPEND,
    reason,
    grantedById,
  );
}

/**
 * Remove favours from a player (penalty/correction).
 */
export async function removeFavours(
  db: Database,
  playerId: string,
  categoryId: string,
  amount: number,
  reason: string | null,
  grantedById: string,
): Promise<FavourTransaction> {
  if (amount <= 0) {
    throw new Error('Remove amount must be positive');
  }

  return applyTransaction(
    db,
    playerId,
    categoryId,
    -amount, // negative for removal
    FavourTransactionType.REMOVE,
    reason,
    grantedById,
  );
}

/**
 * Get transaction history for a player, optionally filtered by category.
 */
export async function getHistory(
  db: Database,
  playerId: string,
  filters: TransactionFilters = {},
): Promise<(FavourTransaction & { categoryName: string })[]> {
  const conditions: SQL[] = [eq(favourTransactions.playerId, playerId)];

  if (filters.categoryId) {
    conditions.push(eq(favourTransactions.categoryId, filters.categoryId));
  }

  if (filters.type) {
    conditions.push(eq(favourTransactions.type, filters.type));
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await db
    .select({
      transaction: favourTransactions,
      categoryName: favourCategories.name,
    })
    .from(favourTransactions)
    .innerJoin(favourCategories, eq(favourTransactions.categoryId, favourCategories.id))
    .where(and(...conditions))
    .orderBy(desc(favourTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...toTransaction(r.transaction),
    categoryName: r.categoryName,
  }));
}

/**
 * Get all transactions (staff overview), optionally filtered by category,
 * player, grantor, or transaction type.
 */
export async function getAllHistory(
  db: Database,
  filters: TransactionFilters = {},
): Promise<(FavourTransaction & { categoryName: string; playerName: string | null; discordUsername: string })[]> {
  const conditions: SQL[] = [];

  if (filters.categoryId) {
    conditions.push(eq(favourTransactions.categoryId, filters.categoryId));
  }

  if (filters.playerId) {
    conditions.push(eq(favourTransactions.playerId, filters.playerId));
  }

  if (filters.grantedById) {
    conditions.push(eq(favourTransactions.grantedById, filters.grantedById));
  }

  if (filters.type) {
    conditions.push(eq(favourTransactions.type, filters.type));
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      transaction: favourTransactions,
      categoryName: favourCategories.name,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(favourTransactions)
    .innerJoin(favourCategories, eq(favourTransactions.categoryId, favourCategories.id))
    .innerJoin(players, eq(favourTransactions.playerId, players.id))
    .where(whereClause)
    .orderBy(desc(favourTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...toTransaction(r.transaction),
    categoryName: r.categoryName,
    playerName: r.playerName,
    discordUsername: r.discordUsername,
  }));
}

// ============================================================
// Mappers
// ============================================================

function toCategory(row: typeof favourCategories.$inferSelect): FavourCategory {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    description: row.description,
    emoji: row.emoji,
    colour: row.colour,
    spendableOn: row.spendableOn as string[] | null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBalance(row: typeof favourBalances.$inferSelect): FavourBalance {
  return {
    id: row.id,
    playerId: row.playerId,
    categoryId: row.categoryId,
    balance: row.balance,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransaction(row: typeof favourTransactions.$inferSelect): FavourTransaction {
  return {
    id: row.id,
    playerId: row.playerId,
    categoryId: row.categoryId,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    type: row.type as FavourTransaction['type'],
    reason: row.reason,
    grantedById: row.grantedById,
    simTick: row.simTick,
    simDate: row.simDate,
    createdAt: row.createdAt.toISOString(),
  };
}
