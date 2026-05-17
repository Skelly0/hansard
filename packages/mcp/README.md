# @hansard/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
read-only Hansard tools to an external LLM client (Claude Desktop, Claude Code,
or any other MCP-compatible client). Talk to your DPS season in natural
language: "what bills are pending?", "what's my favour balance?", "show the
current cabinet."

This is **read-only in v1**. No mutations are exposed.

## How it works

- The server speaks MCP over stdio.
- It opens its own Postgres connection via `@hansard/db` and calls Hansard's
  service functions directly (same code path the API routes use).
- Identity + permissions come from a single bearer-auth call to
  `/api/auth/mcp/me`, refreshed every 5 minutes. The bearer token is obtained
  via a Discord-OAuth-backed device flow and stored locally.

## Setup

### 1. Apply the schema

The MCP token + device-code tables are added to `@hansard/db`. From the repo root:

```bash
pnpm db:push
```

### 2. Authenticate

Run `login` once. This opens your browser, walks you through Discord OAuth, and
writes a 90-day token to `~/.config/hansard-mcp/token.json` (or the Windows
equivalent).

```bash
pnpm --filter @hansard/mcp login
```

You'll need:

- `HANSARD_API_URL` — base URL of the Hansard API (default `http://localhost:3001`).

### 3. Wire up Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), or the equivalent on
Linux:

```json
{
  "mcpServers": {
    "hansard": {
      "command": "pnpm",
      "args": ["--filter", "@hansard/mcp", "start"],
      "cwd": "/absolute/path/to/hansard",
      "env": {
        "HANSARD_API_URL": "http://localhost:3001",
        "DATABASE_URL": "postgres://user:pass@localhost:5432/hansard"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "hansard" listed under MCP tools, and
asking "list the active bills" will trigger a tool call.

### 4. Logging out

```bash
pnpm --filter @hansard/mcp logout
```

This revokes the token on the server and deletes the local file.

## v1 tools

All read-only. Permissions inherited from your office holdings — same as the
webapp and bot.

| Tool | What it does |
|---|---|
| `get_my_player` | Your own player profile. |
| `get_player` | Fetch a player by UUID. |
| `list_players` | Search/filter players (by party, faction, name, etc.). |
| `list_bills` | List bills with filters. |
| `get_bill` | Fetch a bill by slug or bill number. |
| `search_bills` | Full-text search bills. |
| `list_votes` | List elections with filters. |
| `get_vote` | One election + its candidates. |
| `get_vote_results` | Tally / results for a closed election. |
| `list_tickets` | List tickets visible to you with filters. |
| `get_ticket` | Fetch one visible ticket with replies/messages and visible history. |
| `list_parties` | Parties with member counts and leaders. |
| `get_party` | One party + full member roster. |
| `list_offices` | All active offices + current holders. |
| `get_office` | One office + holder history. |
| `get_simulation_state` | Current sim clock + recent advances. |
| `list_favour_categories` | Configured favour categories. |
| `get_my_favours` | Your balances + recent transactions. |
| `get_favour_leaderboard` | Top players by favour balance in a category. |
| `list_documents` | Documents with filters. |
| `get_document` | One document by slug. |
| `search_documents` | Full-text search documents. |

## Caveats

- **`DATABASE_URL` lives on the client machine.** That's a foot-gun even for
  read-only access — be deliberate about which Postgres role's credentials you
  put in `claude_desktop_config.json`. A future revision can swap the tool
  handlers to call the API over HTTP if hosting separation matters.
- **Permission freshness is 5 minutes.** Office changes (new appointments etc.)
  take up to one cache cycle to propagate to the MCP server. Restart the
  server (or wait) if you need an immediate update.
- **Tokens** last 90 days sliding (refreshed on use) with a hard 1-year cap.
  They're stored as a sha-256 hash on the server, so a DB read leak doesn't
  expose live bearers.

## Server-side env (production)

The API needs `PUBLIC_API_URL` set in production so device-flow links don't
trust the `Host` header (which a `trustProxy: true` Fastify will otherwise
reflect). Example:

```
PUBLIC_API_URL=https://api.hansard.example
```
