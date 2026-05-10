import { z } from 'zod';
import { getDocument, listDocuments, searchDocuments } from '@hansard/api/services/documentService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerDocumentTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_documents',
    {
      description: 'List documents (constitutions, treaties, party platforms, etc.) with optional filters.',
      inputSchema: {
        collectionId: z.string().uuid().optional(),
        authorId: z.string().uuid().optional(),
        accessLevel: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args) => {
      const session = await ctx.session.get();
      const result = await listDocuments(ctx.db, args as Parameters<typeof listDocuments>[1], {
        isStaff: session.isStaff,
      });
      return jsonResult(result);
    }),
  );

  server.registerTool(
    'get_document',
    {
      description: 'Fetch a single document by slug, including its full current content.',
      inputSchema: { slug: z.string().min(1) },
    },
    safeHandler(async ({ slug }) => {
      const session = await ctx.session.get();
      const doc = await getDocument(ctx.db, slug, { isStaff: session.isStaff });
      if (!doc) return errorResult(`No document with slug "${slug}".`);
      return jsonResult(doc);
    }),
  );

  server.registerTool(
    'search_documents',
    {
      description: 'Full-text search across document title and content. Optional collection filter.',
      inputSchema: {
        query: z.string().min(1),
        collectionId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async ({ query, collectionId, limit, offset }) => {
      const session = await ctx.session.get();
      const result = await searchDocuments(ctx.db, query, collectionId, limit, offset, {
        isStaff: session.isStaff,
      });
      return jsonResult(result);
    }),
  );
};
