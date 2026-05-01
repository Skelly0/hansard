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

## Full Spec

See `dps-scaffold.md` for the complete architecture document with all schemas, routes, commands, and design guidelines.
