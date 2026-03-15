import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import type { Database } from '@hansard/db';
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  getVersionHistory,
  searchDocuments,
  getCollections,
} from '../services/documentService.js';

/**
 * Document routes plugin.
 *
 * Expects `fastify.db` to be decorated by the DB plugin.
 */
export default async function documentRoutes(fastify: FastifyInstance) {
  const db = (fastify as any).db as Database;

  // ============================================================
  // GET /api/documents/search — Full-text search (before :slug)
  // ============================================================

  fastify.get<{
    Querystring: {
      q?: string;
      collection?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/documents/search',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { q, collection, limit, offset } = request.query;

      if (!q) {
        return reply.status(400).send({ error: 'Query parameter "q" is required' });
      }

      return searchDocuments(
        db,
        q,
        collection,
        limit ? parseInt(limit, 10) : undefined,
        offset ? parseInt(offset, 10) : undefined,
      );
    },
  );

  // ============================================================
  // GET /api/documents/collections — List collections
  // ============================================================

  fastify.get(
    '/api/documents/collections',
    { preHandler: [requireAuth] },
    async () => {
      return getCollections(db);
    },
  );

  // ============================================================
  // POST /api/documents/collections — Create/update collection (admin)
  // ============================================================

  fastify.post<{
    Body: {
      name: string;
      type: string;
      description?: string;
      sortOrder?: number;
      isPublic?: boolean;
    };
  }>(
    '/api/documents/collections',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { name, type, description, sortOrder, isPublic } = request.body;

      if (!name || !type) {
        return reply.status(400).send({ error: 'name and type are required' });
      }

      // Import directly for the insert
      const { documentCollections } = await import('@hansard/db');
      const [collection] = await db
        .insert(documentCollections)
        .values({
          name,
          type,
          description: description ?? null,
          sortOrder: sortOrder ?? 0,
          isPublic: isPublic ?? true,
        })
        .returning();

      return reply.status(201).send(collection);
    },
  );

  // ============================================================
  // GET /api/documents — List documents with filters
  // ============================================================

  fastify.get<{
    Querystring: {
      collectionId?: string;
      authorId?: string;
      tags?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/documents',
    { preHandler: [requireAuth] },
    async (request) => {
      const { collectionId, authorId, tags, limit, offset } = request.query;

      return listDocuments(db, {
        collectionId,
        authorId,
        tags: tags ? tags.split(',') : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    },
  );

  // ============================================================
  // GET /api/documents/:slug — Get document with content
  // ============================================================

  fastify.get<{ Params: { slug: string } }>(
    '/api/documents/:slug',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const doc = await getDocument(db, request.params.slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }
      return doc;
    },
  );

  // ============================================================
  // GET /api/documents/:slug/versions — Version history
  // ============================================================

  fastify.get<{ Params: { slug: string } }>(
    '/api/documents/:slug/versions',
    { preHandler: [requireAuth] },
    async (request) => {
      return getVersionHistory(db, request.params.slug);
    },
  );

  // ============================================================
  // GET /api/documents/:slug/diff — Diff between versions
  // ============================================================

  fastify.get<{
    Params: { slug: string };
    Querystring: { from?: string; to?: string };
  }>(
    '/api/documents/:slug/diff',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const versions = await getVersionHistory(db, request.params.slug);

      if (versions.length === 0) {
        return reply.status(404).send({ error: 'Document not found or has no versions' });
      }

      const fromNum = request.query.from ? parseInt(request.query.from, 10) : 1;
      const toNum = request.query.to
        ? parseInt(request.query.to, 10)
        : versions[0].versionNumber;

      const fromVersion = versions.find((v) => v.versionNumber === fromNum);
      const toVersion = versions.find((v) => v.versionNumber === toNum);

      if (!fromVersion || !toVersion) {
        return reply.status(404).send({ error: 'One or both version numbers not found' });
      }

      // Simple line-level diff — a proper diff library can be added later
      const fromLines = fromVersion.content.split('\n');
      const toLines = toVersion.content.split('\n');

      return {
        from: { version: fromNum, lineCount: fromLines.length },
        to: { version: toNum, lineCount: toLines.length },
        fromContent: fromVersion.content,
        toContent: toVersion.content,
        // TODO: Use a proper diff library for structured diff output
      };
    },
  );

  // ============================================================
  // POST /api/documents — Create document (staff)
  // ============================================================

  fastify.post<{
    Body: {
      collectionId: string;
      title: string;
      content?: string;
      googleDocUrl?: string;
      parentDocumentId?: string;
      hierarchyLevel?: number;
      authorId?: string;
      accessLevel?: string;
      tags?: string[];
    };
  }>(
    '/api/documents',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const user = request.session.user!;
      const { collectionId, title } = request.body;

      if (!collectionId || !title) {
        return reply.status(400).send({ error: 'collectionId and title are required' });
      }

      const doc = await createDocument(db, request.body, user.id);
      return reply.status(201).send(doc);
    },
  );

  // ============================================================
  // PATCH /api/documents/:slug — Update document (creates new version)
  // ============================================================

  fastify.patch<{
    Params: { slug: string };
    Body: {
      content: string;
      changeDescription?: string;
      amendmentBillId?: string;
    };
  }>(
    '/api/documents/:slug',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.session.user!;
      const { content, changeDescription, amendmentBillId } = request.body;

      if (!content) {
        return reply.status(400).send({ error: 'content is required' });
      }

      const updated = await updateDocument(
        db,
        request.params.slug,
        content,
        user.id,
        changeDescription,
        amendmentBillId,
      );

      if (!updated) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      return updated;
    },
  );
}
