import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolved runtime configuration for the MCP server.
 *
 * Two env knobs are required at minimum:
 *   - HANSARD_API_URL — the base URL of the Hansard API (no trailing slash).
 *     Used for device-flow auth + identity refresh.
 *   - DATABASE_URL    — Postgres connection string. The MCP server reads
 *     directly from the DB to keep tool calls fast; the API is the auth
 *     oracle, not the data hop.
 *
 * Optional:
 *   - HANSARD_MCP_TOKEN_FILE — override the default token file location.
 */
export interface McpConfig {
  apiUrl: string;
  databaseUrl: string;
  tokenFile: string;
}

function defaultTokenFile(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'hansard-mcp', 'token.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'hansard-mcp', 'token.json');
}

export function loadConfig(): McpConfig {
  const apiUrl = (process.env.HANSARD_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const databaseUrl = process.env.DATABASE_URL || '';
  const tokenFile = process.env.HANSARD_MCP_TOKEN_FILE || defaultTokenFile();
  return { apiUrl, databaseUrl, tokenFile };
}
