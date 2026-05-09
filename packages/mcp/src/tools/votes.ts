import { z } from 'zod';
import { VoteService } from '@hansard/api/services/voteService';
import { ElectionStatus, ElectionType, VotingMethod } from '@hansard/shared';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

const STATUS_VALUES = Object.values(ElectionStatus) as [string, ...string[]];
const TYPE_VALUES = Object.values(ElectionType) as [string, ...string[]];
const METHOD_VALUES = Object.values(VotingMethod) as [string, ...string[]];

export const registerVoteTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_votes',
    {
      description: 'List elections (legislative votes, position elections, etc.) with optional filters.',
      inputSchema: {
        status: z.enum(STATUS_VALUES).optional(),
        type: z.enum(TYPE_VALUES).optional(),
        method: z.enum(METHOD_VALUES).optional(),
        forOfficeId: z.string().uuid().optional(),
        createdById: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    safeHandler(async (args) => {
      const svc = new VoteService(ctx.db);
      const { data: elections, total } = await svc.listElections(args as Parameters<VoteService['listElections']>[0]);
      return jsonResult({ count: elections.length, total, elections });
    }),
  );

  server.registerTool(
    'get_vote',
    {
      description: 'Fetch a single election by ID, including configuration and current candidates.',
      inputSchema: { id: z.string().uuid() },
    },
    safeHandler(async ({ id }) => {
      const svc = new VoteService(ctx.db);
      const election = await svc.getElection(id);
      if (!election) return errorResult(`No election with id ${id}.`);
      // getElection already attaches `candidates`; no second fetch needed.
      return jsonResult(election);
    }),
  );

  server.registerTool(
    'get_vote_results',
    {
      description: 'Get the tally and results for a closed/certified election.',
      inputSchema: { id: z.string().uuid() },
    },
    safeHandler(async ({ id }) => {
      const svc = new VoteService(ctx.db);
      const results = await svc.getElectionResults(id);
      return jsonResult(results);
    }),
  );
};
