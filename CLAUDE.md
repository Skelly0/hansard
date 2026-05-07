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
- **Voting algorithms** use a strategy pattern (`TallyStrategy` interface) for 8 methods: FPTP, ranked choice, STV, approval, proportional, yea/nay, two-round runoff, exhaustive ballot.
- **Circular DB references** — some cross-table references (bills↔elections, players↔offices) are stored as plain uuid columns without FK constraints to avoid circular import issues. Linked at query time.
- **Auth flow** — Discord OAuth via `/api/auth/discord` → callback looks up player by `discord_id`, **auto-creates an active player** if absent, aggregates `permissions` from current office holdings (`office_holders` joined to `offices.permissions`). `session.user.id` is `players.id` (UUID), NOT the Discord snowflake. `requireAuth` middleware refetches the player on every request and populates `request.player` for handlers.
- **Frontend gating** — `useAuth()` (TanStack Query wrapper around `/api/auth/me` with `retry: false`) returns `{ user, isStaff, permissions, hasPermission, logout, isLoading }`. Three patterns: route-level `<RouteGuard requireStaff>`, section-level `{isStaff && ...}`, button-level `{hasPermission('x') && ...}`. Backend remains source of truth — frontend gating is for UX.
- **Production cookie/proxy setup** — API is deployed behind Railway's TLS-terminating proxy. Fastify is constructed with `trustProxy: true` so `request.protocol` honours `X-Forwarded-Proto`; without this, `@fastify/session` sees a non-https connection and silently refuses to persist a `secure: true` cookie, breaking login with no error. Session cookies use `sameSite: 'none'` + `secure: true` in production (web ↔ api on different subdomains), `sameSite: 'lax'` + `secure: false` in dev (Vite proxy keeps it same-origin).

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

Document admin (`/document-create`, `/document-edit`, `/document-restore`), bulk favour grants (`/favour-grant-bulk` filtered by party or office), global event timeline (`/sim-events`), moderation appeal review (`/mod appeal-list`, `/mod appeal-review`), staff player administration (`/player-admin character-create`, `/player-admin change-party`), and faction administration (`/faction-create`, `/faction-list`, `/faction-info`, `/faction-edit`, `/faction-dissolve`).

## Full Spec

See `dps-scaffold.md` for the complete architecture document with all schemas, routes, commands, and design guidelines.
