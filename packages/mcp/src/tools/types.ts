import type { Database } from '@hansard/db';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SessionCache } from '../auth/session.js';

export interface ToolContext {
  db: Database;
  session: SessionCache;
}

/**
 * Build a `content`-only CallToolResult that JSON-encodes the payload.
 * MCP clients (Claude Desktop, etc.) display text content directly; structured
 * JSON is more compact and the LLM parses it fine.
 */
export function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export type RegisterToolsFn = (server: McpServer, ctx: ToolContext) => void;
