# Hansard — DPS Season Manager

A Discord bot + Fastify API + React webapp for managing Dynamic Political Simulation seasons.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/db` — Drizzle ORM schema + PostgreSQL migrations
- `packages/shared` — Shared types, constants, status enums
- `packages/bot` — discord.js v14 Discord bot
- `packages/api` — Fastify REST API
- `packages/web` — React 18 + Vite + TanStack Router SPA

## Key Design Decisions

- **The bot is a ledger, not an enforcer.** It tracks what's happening, helps find information, automates tedious bits. The actual political gameplay stays fluid and human-driven.
- **Bot display name is configurable** via `BOT_DISPLAY_NAME` env var (defaults to "Hansard").
- **Warm serif aesthetic** — Crimson Pro for headings, Lora for body text, JetBrains Mono for data. No sans-serif body text. Warm cream backgrounds, terracotta accent. Parliamentary record feel, not SaaS.
- **Theming via CSS variables, not Tailwind `dark:` utilities.** Tailwind colour tokens (`page`, `card`, `text-primary`, `c-bills`, etc. in `packages/web/tailwind.config.ts`) all reference `var(--token)` defined in `packages/web/src/main.css` under `:root` (light) and `[data-theme='dark']` (warm chamber palette — walnut-black page, leather-bound cards, terracotta lifted to `#E89478`, all module accents shifted ~12-18% L). Components keep using `bg-page`, `text-text-primary`, etc. — no `dark:` variants needed. Toggle lives in `ThemeProvider` (`packages/web/src/components/theme/ThemeProvider.tsx`); preference persists to `localStorage['hansard-theme']` as `'light' | 'dark' | 'system'`. An inline script in `packages/web/index.html` applies `data-theme` to `<html>` before React hydrates to avoid a white flash on dark refresh — keep its storage key and resolution logic in sync with the provider. UserMenu hosts the Light/Dark/System pill switch.
- **Voting algorithms** use a strategy pattern (`TallyStrategy` interface) for 8 methods: FPTP, ranked choice, STV, approval, proportional, yea/nay, two-round runoff, exhaustive ballot.
- **Circular DB references** — some cross-table references (bills↔elections, players↔offices) are stored as plain uuid columns without FK constraints to avoid circular import issues. Linked at query time.
- **Auth flow** — Discord OAuth via `/api/auth/discord` → callback looks up player by `discord_id`, **auto-creates an active player** if absent, aggregates `permissions` from current office holdings (`office_holders` joined to `offices.permissions`). `session.user.id` is `players.id` (UUID), NOT the Discord snowflake. `requireAuth` middleware refetches the player on every request and populates `request.player` for handlers.
- **Frontend gating** — `useAuth()` (TanStack Query wrapper around `/api/auth/me` with `retry: false`) returns `{ user, isStaff, permissions, hasPermission, logout, isLoading }`. Three patterns: route-level `<RouteGuard requireStaff>`, section-level `{isStaff && ...}`, button-level `{hasPermission('x') && ...}`. Backend remains source of truth — frontend gating is for UX.
- **Production cookie/proxy setup** — API is deployed behind Railway's TLS-terminating proxy. Fastify is constructed with `trustProxy: true` so `request.protocol` honours `X-Forwarded-Proto`; without this, `@fastify/session` sees a non-https connection and silently refuses to persist a `secure: true` cookie, breaking login with no error. Session cookies use `sameSite: 'none'` + `secure: true` in production (web ↔ api on different subdomains), `sameSite: 'lax'` + `secure: false` in dev (Vite proxy keeps it same-origin).
- **Discord interaction collectors must not race the global handler.** When a command uses `awaitModalSubmit` / `awaitMessageComponent`, the same interaction also reaches the client-level `InteractionCreate` listener in `events/interactionCreate.ts`. If the global handler calls `interaction.reply(...)` for an unknown customId, it consumes the response token and the awaiter's `deferReply()` fails with `DiscordAPIError[10062] Unknown interaction` — surfaced to the user as the generic outer-catch error. Therefore the global modal/button/select handlers only **log** unhandled customIds; they never reply. New awaited customIds need no registration in `COLLECTOR_MANAGED_PREFIXES` for correctness — that list now exists only to short-circuit before component-level dispatchers like `handleTicketModal`.

## Testing

`vitest` is set up in both `packages/web` (with `@testing-library/react` + `happy-dom`) and `packages/api`. Run `pnpm --filter @hansard/web test:run` or `pnpm --filter @hansard/api test:run`. Pure-logic units (auth hooks, color hash, trend formatter, service functions) get TDD. UI integration is verified manually.

## Commands

```bash
pnpm dev:bot          # Start bot in dev mode
pnpm dev:api          # Start API in dev mode
pnpm dev:web          # Start webapp in dev mode
pnpm db:generate      # Generate Drizzle migrations
pnpm db:push          # Push schema to database
pnpm db:studio        # Open Drizzle Studio
docker compose up -d  # Start PostgreSQL + all services
```

## Stack

Node.js 20+, TypeScript, pnpm workspaces, PostgreSQL 16, Drizzle ORM, discord.js v14, Fastify v5, React 18, Vite, TanStack Router + Query, Tailwind CSS, Docker Compose.

## Bot Command Surface (recent additions)

Document admin (`/document-create`, `/document-edit`, `/document-restore`), bulk favour grants (`/favour-grant-bulk` filtered by party or office), global event timeline (`/sim-events`), moderation appeal review (`/mod appeal-list`, `/mod appeal-review`), staff player administration (`/player-admin character-create`, `/player-admin change-party`), and faction administration (`/faction create|list|info|edit|dissolve`).

## Bot Persistence Patterns

- **Vote/election writes are direct DB.** `/vote create` modal handler, `/elect`, and the `vote-confirm:*` button handler all write directly via `db.insert(elections|ballots)`. No API hop.
- **Favour balance mutations are atomic.** `grant.ts` and `spend.ts` use `db.transaction` with `sql\`balance ± ${amount}\`` UPDATE-then-INSERT-fallback. Spend uses a conditional UPDATE (`gte(balance, amount)`) to enforce sufficient funds in a single statement. Mirrors `grantBulk.ts`.
- **No unique constraint on `favour_balances(playerId, categoryId)` yet** — schema comments it as a TODO. Atomicity relies on the conditional UPDATE returning a row; if the row is missing, INSERT fallback runs inside the transaction.
- **`ballots(electionId, voterId)` uniqueness** is also a schema TODO. Bot does a SELECT pre-check inside the same transaction-style flow and surfaces "already voted" if the row exists or a Postgres `23505` is raised.
- **Faction `dissolve` is transactional.** All five ops (member select, null player factionId, event-log insert per member, null parties.factionId, set factions.isActive=false) wrap in `db.transaction`.
- **Character name uniqueness is checked twice** — early UX hint, plus a re-check immediately before insert plus a `23505` catch in the persist block (modal flow has minutes between the two).
- **Pagination collector `end` handler uses `interaction.editReply`** — works for ephemeral messages too. `message.edit` would 404 on ephemeral.
- **Modal handlers re-check permissions for restricted election types** (`legislative_vote`, `position_election`, `appointment_confirmation`). Slash command perms don't carry through to modal submits.

## Full Spec

See `dps-scaffold.md` for the complete architecture document with all schemas, routes, commands, and design guidelines.
