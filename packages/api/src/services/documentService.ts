import { eq, desc, and, ilike, or, sql, count, type SQL } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import {
  documents,
  documentVersions,
  documentCollections,
} from '@hansard/db';
import type {
  Document,
  DocumentVersion,
  DocumentCollection,
} from '@hansard/shared';

// ============================================================
// Types
// ============================================================

export interface CreateDocumentData {
  collectionId: string;
  title: string;
  content?: string;
  googleDocUrl?: string;
  parentDocumentId?: string;
  hierarchyLevel?: number;
  authorId?: string;
  accessLevel?: string;
  tags?: string[];
}

export interface ListDocumentsFilters {
  collectionId?: string;
  authorId?: string;
  tags?: string[];
  accessLevel?: string;
  limit?: number;
  offset?: number;
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
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, slug))
      .limit(1);

    if (!existing) return slug;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// ============================================================
// Mappers
// ============================================================

function toDocument(row: typeof documents.$inferSelect): Document {
  return {
    id: row.id,
    collectionId: row.collectionId,
    title: row.title,
    slug: row.slug,
    content: row.content,
    googleDocUrl: row.googleDocUrl,
    cachedContent: row.cachedContent,
    cachedAt: row.cachedAt?.toISOString() ?? null,
    parentDocumentId: row.parentDocumentId,
    hierarchyLevel: row.hierarchyLevel,
    currentVersion: row.currentVersion,
    authorId: row.authorId,
    accessLevel: row.accessLevel,
    tags: (row.tags ?? []) as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDocumentVersion(row: typeof documentVersions.$inferSelect): DocumentVersion {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    content: row.content,
    changeDescription: row.changeDescription,
    editedById: row.editedById,
    amendmentBillId: row.amendmentBillId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDocumentCollection(row: typeof documentCollections.$inferSelect): DocumentCollection {
  return {
    id: row.id,
    name: row.name,
    type: row.type as DocumentCollection['type'],
    description: row.description,
    sortOrder: row.sortOrder,
    isPublic: row.isPublic,
  };
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Create a new document in a collection.
 * Also creates the initial version (v1) if content is provided.
 */
export async function createDocument(
  db: Database,
  data: CreateDocumentData,
  createdById: string,
): Promise<Document> {
  const baseSlug = generateSlug(data.title);
  const slug = await ensureUniqueSlug(db, baseSlug);

  const [doc] = await db
    .insert(documents)
    .values({
      collectionId: data.collectionId,
      title: data.title,
      slug,
      content: data.content ?? null,
      googleDocUrl: data.googleDocUrl ?? null,
      parentDocumentId: data.parentDocumentId ?? null,
      hierarchyLevel: data.hierarchyLevel ?? 0,
      currentVersion: 1,
      authorId: data.authorId ?? createdById,
      accessLevel: data.accessLevel ?? 'public',
      tags: data.tags ?? [],
    })
    .returning();

  // Create initial version record if content was provided
  if (data.content) {
    await db.insert(documentVersions).values({
      documentId: doc.id,
      versionNumber: 1,
      content: data.content,
      changeDescription: 'Initial version',
      editedById: createdById,
    });
  }

  return toDocument(doc);
}

/**
 * Get a document by slug with its content.
 */
export async function getDocument(
  db: Database,
  slug: string,
): Promise<Document | null> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);

  if (!doc) return null;
  return toDocument(doc);
}

/**
 * List documents with optional filters.
 */
export async function listDocuments(
  db: Database,
  filters: ListDocumentsFilters = {},
): Promise<{ documents: Document[]; total: number }> {
  const conditions: SQL[] = [];

  if (filters.collectionId) {
    conditions.push(eq(documents.collectionId, filters.collectionId));
  }
  if (filters.authorId) {
    conditions.push(eq(documents.authorId, filters.authorId));
  }
  if (filters.accessLevel) {
    conditions.push(eq(documents.accessLevel, filters.accessLevel));
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      sql`${documents.tags}::jsonb ?| array[${sql.join(
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
    .from(documents)
    .where(whereClause)
    .orderBy(desc(documents.updatedAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(documents)
    .where(whereClause);

  return {
    documents: rows.map(toDocument),
    total,
  };
}

/**
 * Update a document's content. Creates a new version record.
 */
export async function updateDocument(
  db: Database,
  slug: string,
  content: string,
  editedById: string,
  changeDescription?: string,
  amendmentBillId?: string,
): Promise<Document | null> {
  const [existing] = await db
    .select()
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);

  if (!existing) return null;

  const newVersion = existing.currentVersion + 1;

  // Create version record
  await db.insert(documentVersions).values({
    documentId: existing.id,
    versionNumber: newVersion,
    content,
    changeDescription: changeDescription ?? null,
    editedById,
    amendmentBillId: amendmentBillId ?? null,
  });

  // Update the main document
  const [updated] = await db
    .update(documents)
    .set({
      content,
      currentVersion: newVersion,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();

  return toDocument(updated);
}

/**
 * Get version history for a document.
 */
export async function getVersionHistory(
  db: Database,
  slug: string,
): Promise<DocumentVersion[]> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);

  if (!doc) return [];

  const rows = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, doc.id))
    .orderBy(desc(documentVersions.versionNumber));

  return rows.map(toDocumentVersion);
}

/**
 * Full-text search across documents (title, content, cached content).
 */
export async function searchDocuments(
  db: Database,
  query: string,
  collectionId?: string,
  limit = 25,
  offset = 0,
): Promise<{ documents: Document[]; total: number }> {
  const searchPattern = `%${query}%`;

  const searchConditions = or(
    ilike(documents.title, searchPattern),
    ilike(documents.content, searchPattern),
    ilike(documents.cachedContent, searchPattern),
  );

  const conditions: SQL[] = [];
  if (searchConditions) conditions.push(searchConditions);
  if (collectionId) conditions.push(eq(documents.collectionId, collectionId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(documents)
    .where(whereClause)
    .orderBy(desc(documents.updatedAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(documents)
    .where(whereClause);

  return {
    documents: rows.map(toDocument),
    total,
  };
}

/**
 * List all document collections.
 */
export async function getCollections(
  db: Database,
): Promise<DocumentCollection[]> {
  const rows = await db
    .select()
    .from(documentCollections)
    .orderBy(documentCollections.sortOrder);

  return rows.map(toDocumentCollection);
}
