import { pgTable, uuid, varchar, text, integer, boolean, timestamp, serial, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { players } from './players';

export type BillType = 'google_doc' | 'short';

// === DOCUMENT COLLECTIONS ===
// Top-level groupings: "Constitution", "Statutes", "Executive Orders", "Worldbuilding", etc.
export const documentCollections = pgTable('document_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(),     // 'legislation' | 'worldbuilding' | 'reference'
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  isPublic: boolean('is_public').default(true).notNull(),
});

// === STATIC DOCUMENTS (non-legislative) ===
// Worldbuilding docs, reference material, the constitution (as a living doc), etc.
// These aren't bills -- they don't go through the legislative pipeline.
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').references(() => documentCollections.id).notNull(),

  title: varchar('title', { length: 256 }).notNull(),
  slug: varchar('slug', { length: 256 }).notNull().unique(),

  // Content can be inline or linked to a Google Doc (or both)
  content: text('content'),                                 // Markdown, for docs authored in the system
  googleDocUrl: varchar('google_doc_url', { length: 512 }), // optional Google Doc link
  cachedContent: text('cached_content'),                    // if linked to Google Doc, cached snapshot
  cachedAt: timestamp('cached_at', { withTimezone: true, mode: 'date' }),

  // Hierarchy (for nested docs like constitution articles/sections)
  parentDocumentId: uuid('parent_document_id').references((): AnyPgColumn => documents.id),
  hierarchyLevel: integer('hierarchy_level').default(0).notNull(),

  // Versioning
  currentVersion: integer('current_version').default(1).notNull(),

  // Metadata
  authorId: uuid('author_id').references(() => players.id),
  accessLevel: varchar('access_level', { length: 16 }).default('public').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// === BILLS ===
// Players can submit full Google Doc bills or short text-only bills.
// The Chancellor (or any player with legislative_leader permission) can also submit on behalf of others.
// The Chancellor puts bills to a legislature vote when they choose -- no formal queue.
export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  title: varchar('title', { length: 256 }).notNull(),
  shortTitle: varchar('short_title', { length: 64 }),    // e.g. "ECON-003"
  slug: varchar('slug', { length: 256 }).notNull().unique(),
  billNumber: serial('bill_number'),                      // auto-incrementing: Bill #1, #2, etc.

  // === SOURCE ===
  billType: varchar('bill_type', { length: 32 }).$type<BillType>().default('google_doc').notNull(),
  googleDocUrl: varchar('google_doc_url', { length: 512 }),
  googleDocId: varchar('google_doc_id', { length: 128 }),  // extracted from URL for API access

  // === CACHED CONTENT ===
  // Snapshot of the Google Doc content, or the authoritative text for short bills.
  cachedContent: text('cached_content'),
  cachedAt: timestamp('cached_at', { withTimezone: true, mode: 'date' }),
  summary: text('summary'),                                // player or staff TL;DR

  // === AUTHORSHIP ===
  authorId: uuid('author_id').references(() => players.id).notNull(),
  // If submitted by Chancellor on someone's behalf, submittedById != authorId
  submittedById: uuid('submitted_by_id').references(() => players.id).notNull(),
  coSponsorIds: jsonb('co_sponsor_ids').$type<string[]>().default([]),

  // === STATUS ===
  // submitted -> voting -> player_passed / player_rejected ->
  //   -> npc_pending -> npc_passed / npc_rejected ->
  //   -> enacted -> active -> amended -> repealed
  // (No queue/scheduled stages -- Chancellor puts bills to vote at their discretion)
  status: varchar('status', { length: 32 }).default('submitted').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),

  // Player house vote
  playerVoteId: uuid('player_vote_id'), // references elections.id — linked at query time to avoid circular import
  playerVoteResult: varchar('player_vote_result', { length: 16 }),  // 'passed' | 'rejected'
  playerVoteAt: timestamp('player_vote_at', { withTimezone: true, mode: 'date' }),

  // NPC house vote (entered manually by staff)
  npcVoteRequired: boolean('npc_vote_required').default(true).notNull(),
  npcVote: jsonb('npc_vote').$type<{
    status: 'pending' | 'passed' | 'rejected' | 'amended';
    tally?: {
      yea: number;
      nay: number;
      abstain: number;
      total: number;
    };
    amendmentNotes?: string;
    decidedAt?: string;
    enteredById?: string;
    notes?: string;
  }>(),

  // Final outcome
  enactedAt: timestamp('enacted_at', { withTimezone: true, mode: 'date' }),
  effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }),
  repealedAt: timestamp('repealed_at', { withTimezone: true, mode: 'date' }),
  repealedByBillId: uuid('repealed_by_bill_id').references((): AnyPgColumn => bills.id),

  // === LEGISLATION CHANNEL POST ===
  // Discord message + channel of the original /bill enact post, captured so /bill repeal
  // can edit the original embed in place rather than spamming a new message.
  legislationChannelId: varchar('legislation_channel_id', { length: 32 }),
  legislationMessageId: varchar('legislation_message_id', { length: 32 }),

  // === COLLECTION & HIERARCHY ===
  collectionId: uuid('collection_id').references(() => documentCollections.id),
  parentDocumentId: uuid('parent_document_id').references(() => documents.id),
  amendsBillId: uuid('amends_bill_id').references((): AnyPgColumn => bills.id),
  amendsDocumentId: uuid('amends_document_id'), // references documents.id — no FK to avoid circular imports

  // === CLASSIFICATION & SEARCH ===
  tags: jsonb('tags').$type<string[]>().default([]),
  policyAreas: jsonb('policy_areas').$type<string[]>().default([]),
  crossReferences: jsonb('cross_references').$type<string[]>().default([]),

  // === ECONOMY & POPSIM EFFECTS ===
  // TODO: link to economy/popsim modules when built
  estimatedEffects: jsonb('estimated_effects').$type<{
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
  }>(),

  // Full-text search (on cached content + title + summary)
  // searchVector: tsvector -- handled by migration-level trigger

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
});

// === BILL STATUS LOG ===
// Every status transition is logged with who did it and when.
export const billStatusLog = pgTable('bill_status_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id').references(() => bills.id).notNull(),

  fromStatus: varchar('from_status', { length: 32 }),
  toStatus: varchar('to_status', { length: 32 }).notNull(),

  changedById: uuid('changed_by_id').references(() => players.id).notNull(),
  notes: text('notes'),

  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id).notNull(),

  versionNumber: integer('version_number').notNull(),
  content: text('content').notNull(),
  changeDescription: varchar('change_description', { length: 512 }),
  editedById: uuid('edited_by_id').references(() => players.id).notNull(),

  // If changed by an enacted bill (amendment)
  amendmentBillId: uuid('amendment_bill_id').references(() => bills.id),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
