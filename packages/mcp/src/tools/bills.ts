import { z } from 'zod';
import { getBill, getBillByNumber, listBills, searchBills } from '@hansard/api/services/billService';
import { BillStatus } from '@hansard/shared';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

const BILL_STATUS_VALUES = Object.values(BillStatus) as [string, ...string[]];

export const registerBillTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_bills',
    {
      description: 'List bills with optional filters by status, author, policy area, or tags. Newest first.',
      inputSchema: {
        status: z.enum(BILL_STATUS_VALUES).optional().describe(
          'One of: ' + BILL_STATUS_VALUES.join(', '),
        ),
        authorId: z.string().uuid().optional(),
        policyArea: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args) => {
      const result = await listBills(ctx.db, args as Parameters<typeof listBills>[1]);
      return jsonResult(result);
    }),
  );

  server.registerTool(
    'get_bill',
    {
      description: 'Fetch a single bill. Accepts either a slug (string) or a bill number (integer).',
      inputSchema: {
        slug: z.string().optional(),
        billNumber: z.number().int().positive().optional(),
      },
    },
    safeHandler(async ({ slug, billNumber }) => {
      if (!slug && billNumber == null) {
        return errorResult('Provide either `slug` or `billNumber`.');
      }
      const bill = slug
        ? await getBill(ctx.db, slug)
        : await getBillByNumber(ctx.db, billNumber!);
      if (!bill) return errorResult('Bill not found.');
      return jsonResult(bill);
    }),
  );

  server.registerTool(
    'search_bills',
    {
      description: 'Full-text search across bill title, summary, and cached content. Case-insensitive substring match.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async ({ query, limit, offset }) => {
      const result = await searchBills(ctx.db, query, limit, offset);
      return jsonResult(result);
    }),
  );
};
