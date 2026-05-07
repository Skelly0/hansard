import { z } from 'zod';
import { VoteService } from '@hansard/api/services/voteService';
import type { ElectionStatus, ElectionType, VotingMethod } from '@hansard/shared';
import { jsonResult, errorResult, type RegisterToolsFn } from './types.js';

export const registerVoteTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_votes',
    {
      description: 'List elections (legislative votes, position elections, etc.) with optional filters.',
      inputSchema: {
        status: z.enum(['draft', 'nominations_open', 'voting_open', 'voting_closed', 'certified', 'cancelled']).optional(),
        type: z.enum(['legislative', 'position_election', 'npc_confirmation', 'referendum']).optional(),
        method: z.enum(['fptp', 'ranked_choice', 'stv', 'approval', 'proportional', 'yea_nay', 'two_round_runoff', 'exhaustive_ballot']).optional(),
        forOfficeId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) => {
      const svc = new VoteService(ctx.db);
      const elections = await svc.listElections(args as {
        status?: ElectionStatus; type?: ElectionType; method?: VotingMethod;
        forOfficeId?: string; limit?: number; offset?: number;
      });
      return jsonResult({ count: elections.length, elections });
    },
  );

  server.registerTool(
    'get_vote',
    {
      description: 'Fetch a single election by ID, including configuration and current candidates.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const svc = new VoteService(ctx.db);
      const election = await svc.getElection(id);
      if (!election) return errorResult(`No election with id ${id}.`);
      const candidates = await svc.listCandidates(id);
      return jsonResult({ election, candidates });
    },
  );

  server.registerTool(
    'get_vote_results',
    {
      description: 'Get the tally and results for a closed/certified election. For ongoing elections, also use get_vote_turnout.',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const svc = new VoteService(ctx.db);
      try {
        const results = await svc.getElectionResults(id);
        return jsonResult(results);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
};
