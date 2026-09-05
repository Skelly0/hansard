# Hansard

A Discord bot, REST API, and web dashboard for running **political roleplay seasons** (Dynamic Political Simulation / "DPS" games). Hansard is the season's ledger: it tracks characters, parties, offices, bills, votes, favours, tickets, and the in-world calendar, and automates the tedious bits so staff can focus on the story.

The bot is a ledger, not an enforcer. It records what happens and helps people find things; the actual politics stay human-driven.

## What it does

- **Characters and parties.** Players create a character with `/character create`, join parties via slash commands or a public reaction board, and staff manage factions and invite-only parties.
- **Offices.** Configurable offices with permission sets (Chancellor, ministers, and so on). Holding an office grants the matching bot and web permissions automatically.
- **Bills and legislation.** Submit bills as Google Docs or short text, put them to a vote, and have passed bills enacted into a laws channel with an audit trail. Amendments, repeals, withdrawals, and version diffs are all covered.
- **Voting.** Eight tally methods (first past the post, ranked choice, single transferable vote, approval, proportional, yea/nay, two-round runoff, exhaustive ballot). Votes run on Discord buttons or emoji reactions and close automatically.
- **Favours.** A political-capital economy with categories, balances, staff grants, and a full ledger.
- **Simulation clock.** Advance in-world time; characters age, may fall ill, and may die, with obituaries posted to a graveyard channel.
- **Tickets.** Player-to-staff tickets with private staff threads and a web view.
- **In-character phones.** Number registration, calls and texts relayed through bot DMs, voicemail, and staff wiretaps, all recorded in an append-only ledger.
- **Web dashboard.** Discord-login web app for browsing everything above, with a warm parliamentary-record aesthetic and dark mode.
- **MCP server.** Read-only [Model Context Protocol](https://modelcontextprotocol.io) tools so an LLM client can answer questions about the season.

## Repository layout

TypeScript monorepo using pnpm workspaces:

| Package | Purpose |
| --- | --- |
| `packages/db` | Drizzle ORM schema and one-shot migration scripts (PostgreSQL) |
| `packages/shared` | Types, constants, status enums, date/aging maths |
| `packages/bot` | discord.js v14 bot |
| `packages/api` | Fastify REST API and Discord OAuth |
| `packages/web` | React 18 + Vite + TanStack Router dashboard |
| `packages/mcp` | Read-only MCP server (see `packages/mcp/README.md`) |

`dps-scaffold.md` is the original architecture document. `CLAUDE.md` holds the detailed design notes and invariants that have accumulated during development; it is worth reading before making changes. `docs/` contains the aging and death guides for staff and players.

## Requirements

- Node.js 20 or newer
- pnpm 9 (`corepack enable` will pick up the pinned version)
- PostgreSQL 16 (Docker Compose provides one)
- A Discord application with a bot user

## Quick start (local development)

1. **Create a Discord application** at the [Discord Developer Portal](https://discord.com/developers/applications).
   - Under *Bot*, create a bot user and copy its token. Enable the **Server Members** and **Message Content** privileged intents.
   - Under *OAuth2*, copy the client ID and secret, and add `http://localhost:3001/api/auth/discord/callback` to the redirect allowlist.
   - Invite the bot to your server with the `bot` and `applications.commands` scopes.

2. **Configure the environment.**

   ```bash
   cp .env.example .env
   ```

   Fill in at least `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DATABASE_URL`, and a random `SESSION_SECRET`. Every other variable is documented inline in `.env.example`; channel IDs are optional and features that post to a channel simply report `not_configured` until you set them.

3. **Install and start Postgres.**

   ```bash
   pnpm install
   docker compose up -d postgres
   ```

4. **Create the schema.**

   ```bash
   pnpm db:push
   ```

   This pushes the full current Drizzle schema to an empty database. The `migrate:*` scripts in `packages/db/package.json` are for upgrading databases that already carry an older schema; a fresh install does not need them.

5. **Run the services** in three terminals:

   ```bash
   pnpm dev:bot
   pnpm dev:api
   pnpm dev:web
   ```

   The web app is served at `http://localhost:5173` and proxies `/api` to the API on port 3001.

6. **Make yourself staff.** Give yourself a Discord role named `Staff` (or list your staff role in `STAFF_ROLE_IDS` / `STAFF_ROLE_ID`), and after logging in once through the web app set `is_staff = true` on your `players` row in Postgres. Most staff checks accept either signal; phone admin commands deliberately require both.

7. **Seed the season.** Use `/ticket category-create`, `/party create`, `/faction create`, and `/favour category-create` to set up the world, then `/time set` to place the in-world clock.

## Running with Docker Compose

`docker compose up -d` builds and starts Postgres, the bot, the API, and the web container (nginx serving the built SPA and proxying `/api` to the API). Set `VITE_API_URL=/api` and let the compose file supply `API_UPSTREAM`. See the comments in `Dockerfile.web` and `packages/web/nginx.conf.template` for how the same-origin proxy and runtime DNS resolution work on hosts such as Railway.

In production:

- `NODE_ENV=production` makes the API refuse to start without a real `SESSION_SECRET`.
- `DISCORD_REDIRECT_URI` must point at the **web** origin (for example `https://hansard.example/api/auth/discord/callback`) and that exact URL must be in the Discord redirect allowlist.
- Web sessions live in the `sessions` Postgres table, so API restarts do not log users out.

## Discord channel configuration

Hansard never hardcodes a server's channel IDs. Each feature that posts publicly reads its target from an environment variable on the bot service:

| Variable | Used for |
| --- | --- |
| `TICKET_CHANNEL_ID` | Private staff threads for `/ticket create` |
| `GAME_EVENTS_CHANNEL_ID` | Public time-advance summaries |
| `GRAVEYARD_CHANNEL_ID` | Character obituaries |
| `LEGISLATION_CHANNEL_ID` | Enacted laws, amendments, repeals |
| `MOD_LOG_CHANNEL_ID` | Staff action audit log |
| `PARTY_JOIN_CHANNEL_ID` | The reaction-based party join board |
| `PHONE_LOG_CHANNEL_ID` | Private phone call and text log threads |
| `PHONE_TAP_CHANNEL_ID` | Default wiretap mirror destination |

Leave a variable empty to disable that feature's channel output.

## Testing

```bash
pnpm -r --if-present test:run
```

Or per package, for example `pnpm --filter @hansard/bot test:run`. Integration tests that need a real database run only when `TEST_DATABASE_URL` is set and refuse to run if it equals `DATABASE_URL`, so a test run can never touch your live season.

## Notes for forks

- Slash command count is capped at 100 per guild by Discord; new actions should be added as subcommands of existing commands.
- The services run under `tsx watch` rather than compiled output. See the "Production runs `tsx watch`" note in `CLAUDE.md` before attempting a compiled build.
- The bot display name is configurable through `BOT_DISPLAY_NAME`.

## License

[MIT](./LICENSE).
