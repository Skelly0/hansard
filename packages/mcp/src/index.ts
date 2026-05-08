#!/usr/bin/env node
import 'dotenv/config';
import { runServer } from './server.js';
import { runLogin, runLogout } from './cli.js';

const HELP = `hansard-mcp — Model Context Protocol server for the Hansard DPS

Usage:
  hansard-mcp                Start the MCP server on stdio (for Claude Desktop, etc.)
  hansard-mcp login          Interactive device-flow login; saves a token locally.
  hansard-mcp logout         Revoke the saved token on the server and delete it locally.
  hansard-mcp --help         Show this message.

Required env:
  HANSARD_API_URL            Base URL of the Hansard API (default http://localhost:3001).
  DATABASE_URL               Postgres connection string (only when running the server).

Optional env:
  HANSARD_MCP_TOKEN_FILE     Override the default token file location.
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }

  if (cmd === 'login') {
    await runLogin();
    return;
  }

  if (cmd === 'logout') {
    await runLogout();
    return;
  }

  if (cmd && cmd !== 'serve') {
    process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(2);
  }

  await runServer();
}

main().catch((err) => {
  process.stderr.write(`[hansard-mcp] Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
