import type { Database } from '@hansard/db';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AuthExpiredError, type SessionCache } from '../auth/session.js';

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

/**
 * Wrap a tool handler so expected errors (auth-expired, permission denied,
 * service-layer throws) become structured MCP errors the LLM can read,
 * rather than crashing the protocol with an unhandled rejection.
 */
export function safeHandler<Args, R extends CallToolResult = CallToolResult>(
  fn: (args: Args) => Promise<R>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return errorResult(err.message);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Tool error: ${msg}`);
    }
  };
}

export type RegisterToolsFn = (server: McpServer, ctx: ToolContext) => void;
