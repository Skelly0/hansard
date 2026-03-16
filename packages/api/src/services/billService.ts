import { eq, desc, and, ilike, or, sql, count, type SQL } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import {
  bills,
  billStatusLog,
  elections,
  ballots,
  documents,
  players,
} from '@hansard/db';
import type {
  Bill,
  BillStatusLogEntry,
  NpcVote,
  EstimatedEffects,
} from '@hansard/shared';
import { BillStatus } from '@hansard/shared';
import { extractDocId, cacheDocContent } from './googleDocService.js';
import { updateDocument } from './documentService.js';

// ============================================================
// Types
// ============================================================

export interface SubmitBillData {
  title: string;
  googleDocUrl: string;
  summary?: string;
  tags?: string[];
  policyAreas?: string[];
  shortTitle?: string;
  collectionId?: string;
  coSponsorIds?: string[];
  amendsBillId?: string;
  amendsDocumentId?: string;
}

export interface ListBillsFilters {
  status?: string;
  authorId?: string;
  policyArea?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface UpdateBillData {
  title?: string;
  shortTitle?: string;
  summary?: string;
  tags?: string[];
  policyAreas?: string[];
  crossReferences?: string[];
  collectionId?: string;
}

// ============================================================
// Slug Generation
// ============================================================

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function ensureUniqueSlug(db: Database, baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const [existing] = await db
      .select({ id: bills.id })
      .from(bills)
      .where(eq(bills.slug, slug))
      .limit(1);

    if (!existing) return slug;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// ============================================================
// Mappers
// ============================================================

function toBill(row: typeof bills.$inferSelect): Bill {
  return {
    id: row.id,
    title: row.title,
    shortTitle: row.shortTitle,
    slug: row.slug,
    billNumber: row.billNumber,
    googleDocUrl: row.googleDocUrl,
    googleDocId: row.googleDocId,
    cachedContent: row.cachedContent,
    cachedAt: row.cachedAt?.toISOString() ?? null,
    summary: row.summary,
    authorId: row.authorId,
    submittedById: row.submittedById,
    coSponsorIds: (row.coSponsorIds ?? []) as string[],
    status: row.status as Bill['status'],
    submittedAt: row.submittedAt.toISOString(),
    playerVoteId: row.playerVoteId,
    playerVoteResult: row.playerVoteResult,
    playerVoteAt: row.playerVoteAt?.toISOString() ?? null,
    npcVoteRequired: row.npcVoteRequired,
    npcVote: (row.npcVote as NpcVote) ?? null,
    enactedAt: row.enactedAt?.toISOString() ?? null,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    repealedAt: row.repealedAt?.toISOString() ?? null,
    repealedByBillId: row.repealedByBillId,
    collectionId: row.collectionId,
    parentDocumentId: row.parentDocumentId,
    amendsBillId: row.amendsBillId,
    amendsDocumentId: row.amendsDocumentId,
    tags: (row.tags ?? []) as string[],
    policyAreas: (row.policyAreas ?? []) as string[],
    crossReferences: (row.crossReferences ?? []) as string[],
    estimatedEffects: (row.estimatedEffects as EstimatedEffects) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStatusLogEntry(row: typeof billStatusLog.$inferSelect): BillStatusLogEntry {
  return {
    id: row.id,
    billId: row.billId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus!,
    changedById: row.changedById,
    notes: row.notes,
    simTick: row.simTick,
    simDate: row.simDate,
    createdAt: row.createdAt.toISOString(),
  };
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Submit a new bill. The author and submitter are the same person.
 */
export async function submitBill(
  db: Database,
  authorId: string,
  data: SubmitBillData,
): Promise<Bill> {
  return submitBillFor(db, authorId, authorId, data);
}

/**
 * Submit a bill on behalf of another player.
 * Sets authorId to the actual author and submittedById to whoever submitted it
 * (e.g. the Chancellor submitting on someone's behalf).
 */
export async function submitBillFor(
  db: Database,
  authorId: string,
  submittedById: string,
  data: SubmitBillData,
): Promise<Bill> {
  const baseSlug = generateSlug(data.title);
  const slug = await ensureUniqueSlug(db, baseSlug);
  const googleDocId = extractDocId(data.googleDocUrl);

  const [bill] = await db
    .insert(bills)
    .values({
      title: data.title,
      shortTitle: data.shortTitle ?? null,
      slug,
      googleDocUrl: data.googleDocUrl,
      googleDocId,
      summary: data.summary ?? null,
      authorId,
      submittedById,
      coSponsorIds: data.coSponsorIds ?? [],
      status: BillStatus.SUBMITTED,
      tags: data.tags ?? [],
      policyAreas: data.policyAreas ?? [],
      collectionId: data.collectionId ?? null,
      amendsBillId: data.amendsBillId ?? null,
      amendsDocumentId: data.amendsDocumentId ?? null,
    })
    .returning();

  // Log the initial status
  await db.insert(billStatusLog).values({
    billId: bill.id,
    fromStatus: null,
    toStatus: BillStatus.SUBMITTED,
    changedById: submittedById,
    notes: authorId !== submittedById
      ? `Submitted on behalf of author by another player`
      : null,
  });

  // Attempt to cache content from the Google Doc
  if (googleDocId) {
    try {
      await cacheDocContent(db, bill.id);
    } catch (err) {
      console.warn(`Failed to cache Google Doc content for bill ${bill.id}:`, err);
    }
  }

  return toBill(bill);
}

/**
 * Get a bill by slug, including full details.
 */
export async function getBill(
  db: Database,
  slug: string,
): Promise<Bill | null> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) return null;
  return toBill(bill);
}

/**
 * Get a bill by its auto-incrementing bill number.
 */
export async function getBillByNumber(
  db: Database,
  billNumber: number,
): Promise<Bill | null> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.billNumber, billNumber))
    .limit(1);

  if (!bill) return null;
  return toBill(bill);
}

/**
 * List bills with optional filters.
 */
export async function listBills(
  db: Database,
  filters: ListBillsFilters = {},
): Promise<{ bills: Bill[]; total: number }> {
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(eq(bills.status, filters.status));
  }
  if (filters.authorId) {
    conditions.push(eq(bills.authorId, filters.authorId));
  }
  if (filters.policyArea) {
    // Check if the policyArea is in the JSONB array
    conditions.push(
      sql`${bills.policyAreas}::jsonb @> ${JSON.stringify([filters.policyArea])}::jsonb`,
    );
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      sql`${bills.tags}::jsonb ?| array[${sql.join(
        filters.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;

  const rows = await db
    .select()
    .from(bills)
    .where(whereClause)
    .orderBy(desc(bills.submittedAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(bills)
    .where(whereClause);

  return {
    bills: rows.map(toBill),
    total,
  };
}

/**
 * Full-text search across bills (title, summary, cached content).
 */
export async function searchBills(
  db: Database,
  query: string,
  limit = 25,
  offset = 0,
): Promise<{ bills: Bill[]; total: number }> {
  const searchPattern = `%${query}%`;

  const whereClause = or(
    ilike(bills.title, searchPattern),
    ilike(bills.summary, searchPattern),
    ilike(bills.cachedContent, searchPattern),
  );

  const rows = await db
    .select()
    .from(bills)
    .where(whereClause)
    .orderBy(desc(bills.submittedAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(bills)
    .where(whereClause);

  return {
    bills: rows.map(toBill),
    total,
  };
}

/**
 * Update bill metadata (tags, summary, policy areas, etc.).
 */
export async function updateBill(
  db: Database,
  slug: string,
  updates: UpdateBillData,
): Promise<Bill | null> {
  const [existing] = await db
    .select({ id: bills.id })
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!existing) return null;

  const setValues: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.title !== undefined) setValues.title = updates.title;
  if (updates.shortTitle !== undefined) setValues.shortTitle = updates.shortTitle;
  if (updates.summary !== undefined) setValues.summary = updates.summary;
  if (updates.tags !== undefined) setValues.tags = updates.tags;
  if (updates.policyAreas !== undefined) setValues.policyAreas = updates.policyAreas;
  if (updates.crossReferences !== undefined) setValues.crossReferences = updates.crossReferences;
  if (updates.collectionId !== undefined) setValues.collectionId = updates.collectionId;

  const [updated] = await db
    .update(bills)
    .set(setValues)
    .where(eq(bills.slug, slug))
    .returning();

  return toBill(updated);
}

/**
 * Update economy/popsim estimated effects on a bill (staff only).
 */
export async function updateEffects(
  db: Database,
  slug: string,
  effects: EstimatedEffects,
): Promise<Bill | null> {
  const [updated] = await db
    .update(bills)
    .set({
      estimatedEffects: effects,
      updatedAt: new Date(),
    })
    .where(eq(bills.slug, slug))
    .returning();

  if (!updated) return null;
  return toBill(updated);
}

/**
 * Create a legislature vote (election) linked to a bill.
 * Advances the bill status to 'voting'.
 */
export async function createVoteOnBill(
  db: Database,
  slug: string,
  createdById: string,
): Promise<{ bill: Bill; electionId: string }> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) {
    throw new Error(`Bill not found: ${slug}`);
  }

  if (bill.status !== BillStatus.SUBMITTED) {
    throw new Error(`Bill is not in 'submitted' status (current: ${bill.status})`);
  }

  // Create a yea/nay/abstain election linked to this bill
  const now = new Date();
  const votingCloses = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days default

  const [election] = await db
    .insert(elections)
    .values({
      title: `Vote on: ${bill.title}`,
      description: bill.summary ?? `Legislative vote on Bill #${bill.billNumber}: ${bill.title}`,
      type: 'legislative_vote',
      method: 'yea_nay_abstain',
      requiredPermission: 'legislative_leader',
      config: {
        majorityType: 'simple',
        passThreshold: 0.5,
        anonymousBallots: false,
        sealedResults: false,
      },
      relatedBillId: bill.id,
      createdById,
      status: 'voting_open',
      votingOpensAt: now,
      votingClosesAt: votingCloses,
    })
    .returning();

  // Update bill status
  const oldStatus = bill.status;
  const [updated] = await db
    .update(bills)
    .set({
      status: BillStatus.VOTING,
      playerVoteId: election.id,
      updatedAt: now,
    })
    .where(eq(bills.id, bill.id))
    .returning();

  // Log status change
  await db.insert(billStatusLog).values({
    billId: bill.id,
    fromStatus: oldStatus,
    toStatus: BillStatus.VOTING,
    changedById: createdById,
    notes: `Legislature vote created (election ${election.id})`,
  });

  return { bill: toBill(updated), electionId: election.id };
}

/**
 * Enter NPC house vote result for a bill.
 */
export async function enterNpcVote(
  db: Database,
  slug: string,
  tally: { yea: number; nay: number; abstain: number },
  notes: string | null,
  enteredById: string,
): Promise<Bill> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) {
    throw new Error(`Bill not found: ${slug}`);
  }

  const total = tally.yea + tally.nay + tally.abstain;
  const passed = tally.yea > tally.nay;

  const npcVote: NpcVote = {
    status: passed ? 'passed' : 'rejected',
    tally: { ...tally, total },
    decidedAt: new Date().toISOString(),
    enteredById,
    notes: notes ?? undefined,
  };

  const oldStatus = bill.status;
  const newStatus = passed ? BillStatus.NPC_PASSED : BillStatus.NPC_REJECTED;

  const [updated] = await db
    .update(bills)
    .set({
      npcVote,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(bills.id, bill.id))
    .returning();

  await db.insert(billStatusLog).values({
    billId: bill.id,
    fromStatus: oldStatus,
    toStatus: newStatus,
    changedById: enteredById,
    notes: `NPC house vote: ${tally.yea} yea / ${tally.nay} nay / ${tally.abstain} abstain${notes ? ` — ${notes}` : ''}`,
  });

  return toBill(updated);
}

/**
 * Auto-apply an enacted amendment to its target document.
 * Looks up the target document (via amendsDocumentId or amendsBillId's parentDocumentId),
 * copies the amendment's cached content into the document, and marks the parent bill as amended.
 */
async function applyAmendment(db: Database, bill: Bill): Promise<void> {
  // Find the target document
  let targetDocSlug: string | null = null;

  if (bill.amendsDocumentId) {
    // Direct document amendment — look up the document by ID
    const [doc] = await db
      .select({ slug: documents.slug })
      .from(documents)
      .where(eq(documents.id, bill.amendsDocumentId))
      .limit(1);
    if (doc) targetDocSlug = doc.slug;
  } else if (bill.amendsBillId) {
    // Amends another bill — find that bill's parentDocumentId
    const [parentBill] = await db
      .select({ parentDocumentId: bills.parentDocumentId })
      .from(bills)
      .where(eq(bills.id, bill.amendsBillId))
      .limit(1);
    if (parentBill?.parentDocumentId) {
      const [doc] = await db
        .select({ slug: documents.slug })
        .from(documents)
        .where(eq(documents.id, parentBill.parentDocumentId))
        .limit(1);
      if (doc) targetDocSlug = doc.slug;
    }
  }

  if (!targetDocSlug) return;

  // Get amendment content — use cachedContent, re-cache if needed
  let content = bill.cachedContent;
  if (!content) {
    try {
      content = await cacheDocContent(db, bill.id);
    } catch {
      // If we can't fetch content, bail silently
      return;
    }
  }
  if (!content) return;

  // Apply the amendment content to the target document
  await updateDocument(
    db,
    targetDocSlug,
    content,
    bill.authorId,
    `Amendment applied from Bill #${bill.billNumber}: ${bill.title}`,
    bill.id,
  );

  // If amending a bill, update its status to 'amended'
  if (bill.amendsBillId) {
    const [parentBill] = await db
      .select({ status: bills.status })
      .from(bills)
      .where(eq(bills.id, bill.amendsBillId))
      .limit(1);

    if (parentBill) {
      const oldStatus = parentBill.status;
      await db
        .update(bills)
        .set({
          status: BillStatus.AMENDED,
          updatedAt: new Date(),
        })
        .where(eq(bills.id, bill.amendsBillId));

      await db.insert(billStatusLog).values({
        billId: bill.amendsBillId,
        fromStatus: oldStatus,
        toStatus: BillStatus.AMENDED,
        changedById: bill.authorId,
        notes: `Amended by Bill #${bill.billNumber}: ${bill.title}`,
      });
    }
  }
}

/**
 * Mark a bill as enacted.
 */
export async function enactBill(
  db: Database,
  slug: string,
  enactedById: string,
): Promise<Bill> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) {
    throw new Error(`Bill not found: ${slug}`);
  }

  const oldStatus = bill.status;
  const now = new Date();

  const [updated] = await db
    .update(bills)
    .set({
      status: BillStatus.ENACTED,
      enactedAt: now,
      effectiveAt: now,
      updatedAt: now,
    })
    .where(eq(bills.id, bill.id))
    .returning();

  await db.insert(billStatusLog).values({
    billId: bill.id,
    fromStatus: oldStatus,
    toStatus: BillStatus.ENACTED,
    changedById: enactedById,
    notes: 'Bill enacted',
  });

  // Auto-apply amendment to target document
  const enacted = await getBill(db, slug);
  if (enacted && (enacted.amendsBillId || enacted.amendsDocumentId)) {
    await applyAmendment(db, enacted);
  }

  return toBill(updated);
}

/**
 * Mark a bill as repealed, linking it to the repealing bill.
 */
export async function repealBill(
  db: Database,
  slug: string,
  repealingBillId: string,
  repealedById: string,
): Promise<Bill> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) {
    throw new Error(`Bill not found: ${slug}`);
  }

  const oldStatus = bill.status;
  const now = new Date();

  const [updated] = await db
    .update(bills)
    .set({
      status: BillStatus.REPEALED,
      repealedAt: now,
      repealedByBillId: repealingBillId,
      updatedAt: now,
    })
    .where(eq(bills.id, bill.id))
    .returning();

  await db.insert(billStatusLog).values({
    billId: bill.id,
    fromStatus: oldStatus,
    toStatus: BillStatus.REPEALED,
    changedById: repealedById,
    notes: `Repealed by bill ${repealingBillId}`,
  });

  return toBill(updated);
}

/**
 * Get the full status history for a bill.
 */
export async function getBillStatusLog(
  db: Database,
  slug: string,
): Promise<BillStatusLogEntry[]> {
  const [bill] = await db
    .select({ id: bills.id })
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) return [];

  const rows = await db
    .select()
    .from(billStatusLog)
    .where(eq(billStatusLog.billId, bill.id))
    .orderBy(desc(billStatusLog.createdAt));

  return rows.map(toStatusLogEntry);
}

/**
 * Get who voted on this bill (from the linked election).
 */
export async function getVoters(
  db: Database,
  slug: string,
): Promise<{
  playerVotes: { voterId: string; choice: string; castAt: string }[];
  npcVote: NpcVote | null;
} | null> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) return null;

  let playerVotes: { voterId: string; choice: string; castAt: string }[] = [];

  if (bill.playerVoteId) {
    const ballotRows = await db
      .select()
      .from(ballots)
      .where(eq(ballots.electionId, bill.playerVoteId))
      .orderBy(ballots.castAt);

    playerVotes = ballotRows.map((b) => {
      const vote = b.vote as { type: string; choice?: string };
      return {
        voterId: b.voterId,
        choice: vote.choice ?? 'unknown',
        castAt: b.castAt.toISOString(),
      };
    });
  }

  return {
    playerVotes,
    npcVote: (bill.npcVote as NpcVote) ?? null,
  };
}
