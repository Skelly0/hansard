import { eq, desc, asc, and, ilike, or, sql, count, inArray, type SQL } from 'drizzle-orm';
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
  ElectionConfig,
  BillType,
} from '@hansard/shared';
import { BillStatus, DEFAULT_VOTE_DURATION_MS } from '@hansard/shared';
import { extractDocId, cacheDocContent, isValidGoogleDocUrl } from './googleDocService.js';
import { updateDocument } from './documentService.js';

// ============================================================
// Types
// ============================================================

export interface SubmitBillData {
  title: string;
  billType?: BillType;
  googleDocUrl?: string | null;
  content?: string;
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
  search?: string;
  tags?: string[];
  sort?: string;
  amendsBillId?: string;
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

export interface BillVoterViewer {
  userId: string;
  isStaff: boolean;
}

const ENACTABLE_STATUSES = new Set<string>([
  BillStatus.PLAYER_PASSED,
  BillStatus.NPC_PASSED,
]);

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

interface LinkedSlugs {
  amendsBillSlug?: string | null;
  amendsDocumentSlug?: string | null;
}

interface BillPlayerSummary {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

interface BillEnrichment extends LinkedSlugs {
  author?: BillPlayerSummary;
  submittedBy?: BillPlayerSummary;
  coSponsors?: BillPlayerSummary[];
}

function toBill(row: typeof bills.$inferSelect, enrichment: BillEnrichment = {}): Bill {
  return {
    id: row.id,
    title: row.title,
    shortTitle: row.shortTitle,
    slug: row.slug,
    billNumber: row.billNumber,
    billType: row.billType,
    googleDocUrl: row.googleDocUrl,
    googleDocId: row.googleDocId,
    cachedContent: row.cachedContent,
    cachedAt: row.cachedAt?.toISOString() ?? null,
    summary: row.summary,
    authorId: row.authorId,
    author: enrichment.author,
    submittedById: row.submittedById,
    submittedBy: enrichment.submittedBy,
    coSponsorIds: (row.coSponsorIds ?? []) as string[],
    coSponsors: enrichment.coSponsors,
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
    amendsBillSlug: enrichment.amendsBillSlug ?? null,
    amendsDocumentId: row.amendsDocumentId,
    amendsDocumentSlug: enrichment.amendsDocumentSlug ?? null,
    tags: (row.tags ?? []) as string[],
    policyAreas: (row.policyAreas ?? []) as string[],
    crossReferences: (row.crossReferences ?? []) as string[],
    estimatedEffects: (row.estimatedEffects as EstimatedEffects) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toBillsEnriched(
  db: Database,
  rows: (typeof bills.$inferSelect)[],
): Promise<Bill[]> {
  const [slugs, playerRefs] = await Promise.all([
    lookupLinkedSlugs(db, rows),
    lookupBillPlayerRefs(db, rows),
  ]);

  return rows.map((row) => toBill(row, {
    ...slugs.get(row.id),
    ...playerRefs.get(row.id),
  }));
}

async function toBillEnriched(
  db: Database,
  row: typeof bills.$inferSelect,
): Promise<Bill> {
  const [enriched] = await toBillsEnriched(db, [row]);
  return enriched;
}

async function lookupLinkedSlugs(
  db: Database,
  rows: (typeof bills.$inferSelect)[],
): Promise<Map<string, LinkedSlugs>> {
  const billIds = [...new Set(rows.map((r) => r.amendsBillId).filter((x): x is string => !!x))];
  const docIds = [...new Set(rows.map((r) => r.amendsDocumentId).filter((x): x is string => !!x))];

  const [billRows, docRows] = await Promise.all([
    billIds.length
      ? db.select({ id: bills.id, slug: bills.slug }).from(bills).where(inArray(bills.id, billIds))
      : Promise.resolve([] as { id: string; slug: string }[]),
    docIds.length
      ? db.select({ id: documents.id, slug: documents.slug }).from(documents).where(inArray(documents.id, docIds))
      : Promise.resolve([] as { id: string; slug: string }[]),
  ]);

  const billSlugMap = new Map(billRows.map((b) => [b.id, b.slug]));
  const docSlugMap = new Map(docRows.map((d) => [d.id, d.slug]));

  const out = new Map<string, LinkedSlugs>();
  for (const row of rows) {
    out.set(row.id, {
      amendsBillSlug: row.amendsBillId ? billSlugMap.get(row.amendsBillId) ?? null : null,
      amendsDocumentSlug: row.amendsDocumentId ? docSlugMap.get(row.amendsDocumentId) ?? null : null,
    });
  }
  return out;
}

async function lookupBillPlayerRefs(
  db: Database,
  rows: (typeof bills.$inferSelect)[],
): Promise<Map<string, Pick<BillEnrichment, 'author' | 'submittedBy' | 'coSponsors'>>> {
  const playerIds = new Set<string>();

  for (const row of rows) {
    playerIds.add(row.authorId);
    playerIds.add(row.submittedById);
    for (const coSponsorId of (row.coSponsorIds ?? []) as string[]) {
      playerIds.add(coSponsorId);
    }
  }

  if (playerIds.size === 0) return new Map();

  const playerRows = await db
    .select({
      id: players.id,
      characterName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(players)
    .where(inArray(players.id, [...playerIds]));

  const playersById = new Map(playerRows.map((player) => [player.id, player]));
  const out = new Map<string, Pick<BillEnrichment, 'author' | 'submittedBy' | 'coSponsors'>>();

  for (const row of rows) {
    const coSponsorIds = (row.coSponsorIds ?? []) as string[];
    out.set(row.id, {
      author: playersById.get(row.authorId),
      submittedBy: playersById.get(row.submittedById),
      coSponsors: coSponsorIds
        .map((id) => playersById.get(id))
        .filter((player): player is BillPlayerSummary => !!player),
    });
  }

  return out;
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

function canViewLinkedElectionVoters(
  election: Pick<typeof elections.$inferSelect, 'status' | 'config'>,
  viewer?: BillVoterViewer,
): boolean {
  if (!viewer) return true;

  const config = election.config as ElectionConfig;
  const detailsArePublic = election.status === 'tallied' || election.status === 'certified';

  if (config.anonymousBallots) return false;
  if (config.sealedResults && !detailsArePublic) return false;
  if (viewer.isStaff) return true;

  return detailsArePublic;
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
  const billType = data.billType ?? (data.content?.trim() ? 'short' : 'google_doc');
  const content = data.content?.trim() ?? '';

  if (billType === 'short' && !content) {
    throw new Error('Short bills require content');
  }
  if (billType === 'google_doc' && !data.googleDocUrl?.trim()) {
    throw new Error('Google Doc bills require a googleDocUrl');
  }
  if (billType === 'google_doc' && !isValidGoogleDocUrl(data.googleDocUrl!.trim())) {
    throw new Error('Google Doc bills require a valid https://docs.google.com/document/d/... URL');
  }

  const googleDocUrl = billType === 'google_doc' ? data.googleDocUrl!.trim() : null;
  const googleDocId = googleDocUrl ? extractDocId(googleDocUrl) : null;
  const now = new Date();

  const [bill] = await db
    .insert(bills)
    .values({
      title: data.title,
      shortTitle: data.shortTitle ?? null,
      slug,
      billType,
      googleDocUrl,
      googleDocId,
      cachedContent: billType === 'short' ? content : null,
      cachedAt: billType === 'short' ? now : null,
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

  return toBillEnriched(db, bill);
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
  return toBillEnriched(db, bill);
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
  return toBillEnriched(db, bill);
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
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(or(
      ilike(bills.title, pattern),
      ilike(bills.summary, pattern),
      ilike(bills.cachedContent, pattern),
    )!);
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      sql`${bills.tags}::jsonb ?| array[${sql.join(
        filters.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]`,
    );
  }
  if (filters.amendsBillId) {
    conditions.push(eq(bills.amendsBillId, filters.amendsBillId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;
  const orderBy =
    filters.sort === 'oldest' ? asc(bills.submittedAt)
    : filters.sort === 'number' ? asc(bills.billNumber)
    : filters.sort === 'title' ? asc(bills.title)
    : desc(bills.submittedAt);

  const rows = await db
    .select()
    .from(bills)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(bills)
    .where(whereClause);

  return {
    bills: await toBillsEnriched(db, rows),
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
    bills: await toBillsEnriched(db, rows),
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

  return toBillEnriched(db, updated);
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
  return toBillEnriched(db, updated);
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
  const votingCloses = new Date(now.getTime() + DEFAULT_VOTE_DURATION_MS);

  // Election insert, bill status flip, and status log must succeed together —
  // otherwise the bill can be left pointing at an orphaned election or stranded
  // in `voting` without an audit row.
  const { updated, electionId } = await db.transaction(async (tx) => {
    const [election] = await tx
      .insert(elections)
      .values({
        title: `Vote on B-${String(bill.billNumber).padStart(3, '0')}: ${bill.title}`,
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

    const oldStatus = bill.status;
    const [updatedBill] = await tx
      .update(bills)
      .set({
        status: BillStatus.VOTING,
        playerVoteId: election.id,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id))
      .returning();

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: oldStatus,
      toStatus: BillStatus.VOTING,
      changedById: createdById,
      notes: `Legislature vote created (election ${election.id})`,
    });

    return { updated: updatedBill, electionId: election.id };
  });

  return { bill: await toBillEnriched(db, updated), electionId };
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

  // Bill status update and status log entry must commit together so we never
  // leave the bill in the new NPC status without an audit row, or vice versa.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bills)
      .set({
        npcVote,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(bills.id, bill.id))
      .returning();

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: oldStatus,
      toStatus: newStatus,
      changedById: enteredById,
      notes: `NPC house vote: ${tally.yea} yea / ${tally.nay} nay / ${tally.abstain} abstain${notes ? ` — ${notes}` : ''}`,
    });

    return row;
  });

  return toBillEnriched(db, updated);
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
  if (!ENACTABLE_STATUSES.has(oldStatus)) {
    throw new Error(
      `Bill #B-${String(bill.billNumber).padStart(3, '0')} is in status \`${oldStatus}\` and cannot be enacted (must be \`player_passed\` or \`npc_passed\`).`,
    );
  }

  const now = new Date();

  // Status flip + audit row must land together; amendment application happens
  // after the transaction commits because it touches a separate document
  // versioning path that has its own error semantics.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bills)
      .set({
        status: BillStatus.ENACTED,
        enactedAt: now,
        effectiveAt: now,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id))
      .returning();

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: oldStatus,
      toStatus: BillStatus.ENACTED,
      changedById: enactedById,
      notes: 'Bill enacted',
    });

    return row;
  });

  // Auto-apply amendment to target document
  const enacted = await getBill(db, slug);
  if (enacted && (enacted.amendsBillId || enacted.amendsDocumentId)) {
    await applyAmendment(db, enacted);
  }

  return toBillEnriched(db, updated);
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

  // Status flip + status log row must commit together.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bills)
      .set({
        status: BillStatus.REPEALED,
        repealedAt: now,
        repealedByBillId: repealingBillId,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id))
      .returning();

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: oldStatus,
      toStatus: BillStatus.REPEALED,
      changedById: repealedById,
      notes: `Repealed by bill ${repealingBillId}`,
    });

    return row;
  });

  return toBillEnriched(db, updated);
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
  viewer?: BillVoterViewer,
): Promise<{
  playerVotes: {
    voterId: string;
    playerId: string;
    characterName: string;
    choice: string;
    castAt: string;
  }[];
  npcVote: NpcVote | null;
} | null> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.slug, slug))
    .limit(1);

  if (!bill) return null;

  let playerVotes: {
    voterId: string;
    playerId: string;
    characterName: string;
    choice: string;
    castAt: string;
  }[] = [];

  if (bill.playerVoteId) {
    const [election] = await db
      .select({
        status: elections.status,
        config: elections.config,
      })
      .from(elections)
      .where(eq(elections.id, bill.playerVoteId))
      .limit(1);

    if (!election || !canViewLinkedElectionVoters(election, viewer)) {
      return {
        playerVotes,
        npcVote: (bill.npcVote as NpcVote) ?? null,
      };
    }

    const ballotRows = await db
      .select({
        ballot: ballots,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(ballots)
      .innerJoin(players, eq(ballots.voterId, players.id))
      .where(eq(ballots.electionId, bill.playerVoteId))
      .orderBy(ballots.castAt);

    playerVotes = ballotRows.map((row) => {
      const vote = row.ballot.vote as { type: string; choice?: string };
      const displayName = row.characterName ?? row.discordUsername;
      return {
        voterId: row.ballot.voterId,
        playerId: row.ballot.voterId,
        characterName: displayName,
        choice: vote.choice ?? 'unknown',
        castAt: row.ballot.castAt.toISOString(),
      };
    });
  }

  return {
    playerVotes,
    npcVote: (bill.npcVote as NpcVote) ?? null,
  };
}
