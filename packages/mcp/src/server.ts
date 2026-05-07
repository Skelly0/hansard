import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { readToken } from './auth/tokenStore.js';
import { SessionCache } from './auth/session.js';
import { getDb } from './db.js';
import { registerAllTools } from './tools/register.js';

/**
 * Boot the MCP server over stdio. Refuses to start without a saved token —
 * device-flow login is interactive and would clash with Claude Desktop's
 * stdio framing. Run `hansard-mcp login` once first.
 */
export async function runServer(): Promise<void> {
  const config = loadConfig();

  const stored = await readToken(config.tokenFile);
  if (!stored) {
    process.stderr.write(
      `[hansard-mcp] No token found at ${config.tokenFile}.\n` +
      `Run \`hansard-mcp login\` first to authenticate, then restart this server.\n`,
    );
    process.exit(1);
  }

  if (!config.databaseUrl) {
    process.stderr.write(
      `[hansard-mcp] DATABASE_URL is required. Set it in your shell or in the\n` +
      `env block of your claude_desktop_config.json mcpServers entry.\n`,
    );
    process.exit(1);
  }

  const db = getDb(config.databaseUrl);
  const session = new SessionCache(config.apiUrl, stored);

  // Validate the token + warm the cache before connecting. If this fails the
  // user gets a clear error in the CLI rather than a cryptic MCP-protocol one.
  try {
    const me = await session.get();
    process.stderr.write(`[hansard-mcp] Authenticated as ${me.username} (${me.playerId}).\n`);
  } catch (err) {
    process.stderr.write(`[hansard-mcp] Auth check failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const server = new McpServer(
    { name: 'hansard', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Read-only access to the Hansard DPS season. Use these tools to look up players, ' +
        'bills, votes, parties, offices, the simulation clock, favour balances, and documents. ' +
        'No mutations are exposed in this version.',
    },
  );

  registerAllTools(server, { db, session });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[hansard-mcp] Connected to stdio transport.\n');
}
