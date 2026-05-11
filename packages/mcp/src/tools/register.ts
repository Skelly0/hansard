import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './types.js';
import { registerPlayerTools } from './players.js';
import { registerBillTools } from './bills.js';
import { registerVoteTools } from './votes.js';
import { registerPartyTools } from './parties.js';
import { registerOfficeTools } from './offices.js';
import { registerSimulationTools } from './simulation.js';
import { registerFavourTools } from './favours.js';
import { registerDocumentTools } from './documents.js';
import { registerTicketTools } from './tickets.js';

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerPlayerTools(server, ctx);
  registerBillTools(server, ctx);
  registerVoteTools(server, ctx);
  registerPartyTools(server, ctx);
  registerOfficeTools(server, ctx);
  registerSimulationTools(server, ctx);
  registerFavourTools(server, ctx);
  registerDocumentTools(server, ctx);
  registerTicketTools(server, ctx);
}
