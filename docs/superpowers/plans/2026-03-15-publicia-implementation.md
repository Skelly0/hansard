# Hansard — DPS Season Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Hansard" — a Discord bot + Fastify API + React webapp for managing Dynamic Political Simulation seasons, as specified in `dps-scaffold.md`. The bot display name is configurable via `BOT_DISPLAY_NAME` env var (defaults to "Hansard").

**Architecture:** TypeScript monorepo (pnpm workspaces) with 5 packages: `db` (Drizzle ORM + PostgreSQL), `shared` (types/constants/utils), `bot` (discord.js v14), `api` (Fastify), `web` (React + Vite + TanStack Router). The bot is a ledger and assistant, not a process enforcer.

**Tech Stack:** Node.js 20+, TypeScript, pnpm workspaces, PostgreSQL 16, Drizzle ORM, discord.js v14, Fastify, React 18, Vite, TanStack Router + Query, Tailwind CSS + shadcn/ui, Docker Compose.

**Reference:** All schemas, routes, commands, and design specs are in `dps-scaffold.md` at the project root. Refer to it for exact field definitions, types, and flows.

---

## Chunk 1: Foundation (Phase 1)

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/bot/package.json`
- Create: `packages/bot/tsconfig.json`
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/index.html`

- [ ] **Step 1: Create workspace root `package.json` and `pnpm-workspace.yaml`**

```json
// package.json
{
  "name": "hansard",
  "private": true,
  "scripts": {
    "dev:bot": "pnpm --filter @hansard/bot dev",
    "dev:api": "pnpm --filter @hansard/api dev",
    "dev:web": "pnpm --filter @hansard/web dev",
    "build": "pnpm -r build",
    "db:generate": "pnpm --filter @hansard/db generate",
    "db:migrate": "pnpm --filter @hansard/db migrate",
    "db:push": "pnpm --filter @hansard/db push",
    "db:studio": "pnpm --filter @hansard/db studio"
  },
  "engines": {
    "node": ">=20"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Create `tsconfig.base.json`**

Shared TypeScript config all packages extend.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Create `.gitignore` and `.env.example`**

`.gitignore`: node_modules, dist, .env, *.log, .turbo, etc.
`.env.example`: all env vars from scaffold (DISCORD_BOT_TOKEN, DATABASE_URL, etc.)

- [ ] **Step 4: Create all 5 package `package.json` + `tsconfig.json` files**

Each package: `@hansard/db`, `@hansard/shared`, `@hansard/bot`, `@hansard/api`, `@hansard/web`.
Each has its own tsconfig extending `../../tsconfig.base.json`.
Internal deps use `workspace:*` protocol.

- [ ] **Step 5: Install all dependencies**

```bash
pnpm install
# Root: typescript, @types/node, tsx
# db: drizzle-orm, postgres, drizzle-kit
# shared: (no external deps, just types)
# bot: discord.js
# api: fastify, @fastify/cors, @fastify/cookie, @fastify/session, @fastify/rate-limit
# web: react, react-dom, @tanstack/react-router, @tanstack/react-query, zustand, tailwindcss, postcss, autoprefixer, vite, @vitejs/plugin-react
```

- [ ] **Step 6: Create web build config files**

`vite.config.ts`, `tailwind.config.ts` (with the full design system tokens from scaffold), `postcss.config.js`, `index.html`.

- [ ] **Step 7: Verify monorepo structure compiles**

```bash
pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold Publicia monorepo with pnpm workspaces"
```

---

### Task 2: Database Schema

**Files:**
- Create: `packages/db/src/schema/simulation.ts`
- Create: `packages/db/src/schema/players.ts`
- Create: `packages/db/src/schema/tickets.ts`
- Create: `packages/db/src/schema/laws.ts`
- Create: `packages/db/src/schema/voting.ts`
- Create: `packages/db/src/schema/moderation.ts`
- Create: `packages/db/src/schema/favours.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/drizzle.config.ts`

- [ ] **Step 1: Create all schema files from scaffold**

Copy the exact Drizzle schema definitions from `dps-scaffold.md` sections:
- Simulation Clock (`simulationClock`, `timeAdvanceLog`)
- Players (`players`, `playerEventLog`, `factions`, `parties`, `offices`, `officeHolders`)
- Tickets (`ticketCategories`, `tickets`, `ticketMessages`, `ticketAuditLog`)
- Laws (`documentCollections`, `bills`, `billStatusLog`, `documents`, `documentVersions`)
- Voting (`elections`, `candidates`, `ballots`)
- Moderation (`modActions`, `modNotes`)
- Favours (`favourCategories`, `favourBalances`, `favourTransactions`)

- [ ] **Step 2: Create barrel exports (`schema/index.ts`, `src/index.ts`)**

`schema/index.ts` re-exports all tables. `src/index.ts` exports drizzle client + schema.

- [ ] **Step 3: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Generate initial migration**

```bash
pnpm db:generate
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add complete database schema with Drizzle ORM"
```

---

### Task 3: Shared Types & Constants

**Files:**
- Create: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/types/players.ts`
- Create: `packages/shared/src/types/bills.ts`
- Create: `packages/shared/src/types/voting.ts`
- Create: `packages/shared/src/types/tickets.ts`
- Create: `packages/shared/src/types/favours.ts`
- Create: `packages/shared/src/types/simulation.ts`
- Create: `packages/shared/src/types/moderation.ts`
- Create: `packages/shared/src/constants/index.ts`
- Create: `packages/shared/src/constants/statuses.ts`
- Create: `packages/shared/src/constants/permissions.ts`
- Create: `packages/shared/src/constants/config.ts`
- Create: `packages/shared/src/utils/index.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Define status enums and permission constants**

All status values from the schema (bill statuses, ticket statuses, election statuses, health statuses, mod action types, voting methods, majority types, office tiers, appointment methods, etc.)

- [ ] **Step 2: Define shared TypeScript types for API responses**

Inferred from Drizzle schema where possible, plus API-specific response/request types per domain.

- [ ] **Step 3: Define permission constants**

`legislative_leader`, `appoint_ministers`, `call_elections`, etc.

- [ ] **Step 4: Create barrel exports**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add shared types, constants, and status enums"
```

---

### Task 4: Bot Skeleton

**Files:**
- Create: `packages/bot/src/index.ts`
- Create: `packages/bot/src/client.ts`
- Create: `packages/bot/src/events/ready.ts`
- Create: `packages/bot/src/events/interactionCreate.ts`
- Create: `packages/bot/src/utils/embeds.ts`
- Create: `packages/bot/src/utils/permissions.ts`
- Create: `packages/bot/src/utils/pagination.ts`
- Create: `packages/bot/src/commands/ping.ts`

- [ ] **Step 1: Create Discord client setup (`client.ts`)**

discord.js Client with required intents (Guilds, GuildMessages, GuildMembers, MessageContent).

- [ ] **Step 2: Create event handlers**

`ready.ts` — logs "{BOT_DISPLAY_NAME} is online" with guild count. `BOT_DISPLAY_NAME` defaults to "Hansard".
`interactionCreate.ts` — routes slash commands to handlers.

- [ ] **Step 3: Create `/ping` test command**

Simple ping/pong to verify the bot works.

- [ ] **Step 4: Create embed utility**

Standardised embed builder with the scaffold's colour system and emoji prefixes.

- [ ] **Step 5: Create bot entrypoint (`index.ts`)**

Loads env vars, initialises DB connection, registers commands, starts bot.

- [ ] **Step 6: Add dev script**

`"dev": "tsx watch src/index.ts"` in bot's package.json.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add Discord bot skeleton with ping command"
```

---

### Task 5: API Skeleton

**Files:**
- Create: `packages/api/src/index.ts`
- Create: `packages/api/src/app.ts`
- Create: `packages/api/src/plugins/cors.ts`
- Create: `packages/api/src/plugins/rateLimit.ts`
- Create: `packages/api/src/plugins/auth.ts`
- Create: `packages/api/src/middleware/requireAuth.ts`
- Create: `packages/api/src/middleware/requireStaff.ts`
- Create: `packages/api/src/middleware/requireRole.ts`
- Create: `packages/api/src/routes/auth.ts`
- Create: `packages/api/src/routes/dashboard.ts`

- [ ] **Step 1: Create Fastify app setup (`app.ts`)**

Register CORS, rate limit, cookie, session plugins. Add health check route.

- [ ] **Step 2: Create auth plugin (Discord OAuth2)**

OAuth2 redirect, callback, session creation, `/api/auth/me`, `/api/auth/logout`.

- [ ] **Step 3: Create middleware chain**

`requireAuth` (validates session), `requireStaff` (checks isStaff), `requireRole` (checks office permissions).

- [ ] **Step 4: Create dashboard route stub**

`GET /api/dashboard/overview` — returns placeholder metrics.

- [ ] **Step 5: Create entrypoint**

Loads env, builds app, listens on `API_PORT`.

- [ ] **Step 6: Add dev script**

`"dev": "tsx watch src/index.ts"` in api's package.json.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add Fastify API skeleton with auth and health check"
```

---

### Task 6: Web App Shell

**Files:**
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/main.css`
- Create: `packages/web/src/router.tsx`
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/components/layout/Shell.tsx`
- Create: `packages/web/src/components/layout/Sidebar.tsx`
- Create: `packages/web/src/components/layout/Breadcrumbs.tsx`
- Create: `packages/web/src/pages/Dashboard.tsx`
- Create: `packages/web/src/pages/Login.tsx`

- [ ] **Step 1: Set up Tailwind with the full design system**

All colours, fonts (Crimson Pro, Lora, JetBrains Mono), typography scale, spacing from the scaffold's aesthetic guidelines.

- [ ] **Step 2: Create app shell with sidebar navigation**

Fixed left sidebar (220px, collapsible to 56px on mobile). Warm cream background. Active item with 3px terracotta left border. Section headers for each system.

- [ ] **Step 3: Create TanStack Router config**

Routes for: Dashboard, Tickets, Bills, Documents, Voting, Offices, Players, Favours, Simulation, Moderation, Login.

- [ ] **Step 4: Create API client**

Fetch wrapper with auth headers, base URL from env, typed response helpers.

- [ ] **Step 5: Create Dashboard page placeholder**

Metric cards grid on cream background. Activity feed placeholder.

- [ ] **Step 6: Create Login page**

Discord OAuth2 login button (terracotta primary button style).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add React webapp shell with sidebar, routing, and design system"
```

---

### Task 7: Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile.bot`
- Create: `Dockerfile.api`
- Create: `Dockerfile.web`

- [ ] **Step 1: Create docker-compose.yml**

Services: postgres (16-alpine), bot, api, web. Shared network. Volume for postgres data. Environment variables from `.env`.

- [ ] **Step 2: Create Dockerfiles for each service**

Multi-stage builds. Node 20-alpine base. Copy workspace deps.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add Docker Compose setup for local development"
```

---

## Chunk 2: Player Registry + Simulation (Phase 2)

### Task 8: Player Service + API Routes

**Files:**
- Create: `packages/api/src/services/playerService.ts`
- Create: `packages/api/src/routes/players.ts`

- [ ] **Step 1: Implement playerService**

- `createCharacter()` — creates player record, calculates starting age favour bonus, assigns Discord roles
- `updateCharacter()` — update bio/portrait, flag name changes for staff
- `getPlayer()` — full dossier query (profile + offices + bills + votes + favours + events)
- `listPlayers()` — filterable list
- `changeParty()` — update party, sync Discord role, log event
- `getPlayerEvents()` — event log query

- [ ] **Step 2: Implement player API routes**

All routes from scaffold: GET/POST/PATCH players, party changes, player tickets/votes/offices/bills/favours/events/health.

- [ ] **Step 3: Commit**

---

### Task 9: Player Discord Commands

**Files:**
- Create: `packages/bot/src/commands/player/create.ts`
- Create: `packages/bot/src/commands/player/edit.ts`
- Create: `packages/bot/src/commands/player/view.ts`
- Create: `packages/bot/src/commands/player/lookup.ts`
- Create: `packages/bot/src/commands/player/party.ts`
- Create: `packages/bot/src/commands/player/history.ts`

- [ ] **Step 1: Implement `/character create` multi-step flow**

Modal 1: Name + Bio. Follow-up for portrait. Modal 2: Age + Faction + Party. Favour bonus preview. Confirmation. Discord role assignment.

- [ ] **Step 2: Implement remaining player commands**

`/character edit`, `/character view`, `/whois`, `/roster`, `/party join|leave|list`, `/history`

- [ ] **Step 3: Commit**

---

### Task 10: Simulation Clock + Aging Pipeline

**Files:**
- Create: `packages/api/src/services/simulationService.ts`
- Create: `packages/api/src/routes/simulation.ts`
- Create: `packages/bot/src/commands/simulation/time.ts`
- Create: `packages/bot/src/commands/simulation/ailment.ts`
- Create: `packages/bot/src/commands/simulation/kill.ts`

- [ ] **Step 1: Implement simulationService**

- `getClock()` — current sim state
- `advanceTime()` — the full aging pipeline: age all players, ailment rolls, death rolls, obituary generation, event logging
- `previewAdvance()` — dry-run showing what would happen
- `manualAilment()` / `manualDeath()` / `heal()`

- [ ] **Step 2: Implement simulation API routes**

All routes from scaffold: GET clock, POST advance, POST preview, GET history, PATCH clock, POST ailment/death/heal.

- [ ] **Step 3: Implement Discord commands**

`/time status|advance|preview|set|pause|unpause`, `/ailment add|remove`, `/kill`

- [ ] **Step 4: Implement graveyard obituary generation**

Auto-generate rich embed from player event log on death. Post to GRAVEYARD_CHANNEL_ID.

- [ ] **Step 5: Commit**

---

## Chunk 3: Tickets (Phase 3)

### Task 11: Ticket System

**Files:**
- Create: `packages/api/src/services/ticketService.ts`
- Create: `packages/api/src/routes/tickets.ts`
- Create: `packages/bot/src/commands/tickets/create.ts`
- Create: `packages/bot/src/commands/tickets/assign.ts`
- Create: `packages/bot/src/commands/tickets/close.ts`
- Create: `packages/bot/src/commands/tickets/list.ts`
- Create: `packages/bot/src/commands/tickets/view.ts`
- Create: `packages/bot/src/components/ticketButtons.ts`
- Create: `packages/bot/src/components/ticketModals.ts`
- Create: `packages/web/src/api/hooks/useTickets.ts`
- Create: `packages/web/src/pages/Tickets.tsx`
- Create: `packages/web/src/pages/TicketDetail.tsx`
- Create: `packages/web/src/components/tickets/TicketList.tsx`
- Create: `packages/web/src/components/tickets/TicketCard.tsx`

- [ ] **Step 1: Implement ticketService** — CRUD, thread creation, message sync, audit log
- [ ] **Step 2: Implement ticket API routes** — all from scaffold
- [ ] **Step 3: Implement Discord commands** — create (modal), view, list, assign, close, note, reply, priority, link
- [ ] **Step 4: Implement ticket buttons/modals** — interactive components
- [ ] **Step 5: Implement webapp ticket pages** — list view with filters, detail view with messages + audit log
- [ ] **Step 6: Commit**

---

## Chunk 4: Bill Pipeline + Documents (Phase 4)

### Task 12: Bill System

**Files:**
- Create: `packages/api/src/services/billService.ts`
- Create: `packages/api/src/services/googleDocService.ts`
- Create: `packages/api/src/routes/bills.ts`
- Create: `packages/bot/src/commands/bills/*.ts` (submit, submitFor, view, search, vote, npcVote, list)
- Create: `packages/web/src/api/hooks/useBills.ts`
- Create: `packages/web/src/pages/Bills.tsx`
- Create: `packages/web/src/pages/BillDetail.tsx`
- Create: `packages/web/src/components/bills/*.tsx`

- [ ] **Step 1: Implement billService** — submission flow, status transitions, Google Doc caching, NPC vote entry
- [ ] **Step 2: Implement googleDocService** — fetch + cache Google Doc content
- [ ] **Step 3: Implement bill API routes** — all from scaffold including search, browse, vote creation, NPC vote, enact, repeal
- [ ] **Step 4: Implement Discord commands** — `/bill submit|submit-for|view|search|list|vote|status`, `/npc-bill`
- [ ] **Step 5: Implement webapp bill pages** — browser with filters/sorting, detail view with status timeline, vote record, effects panel
- [ ] **Step 6: Commit**

### Task 13: Static Documents System

**Files:**
- Create: `packages/api/src/services/documentService.ts`
- Create: `packages/api/src/routes/documents.ts`
- Create: `packages/bot/src/commands/docs/*.ts` (search, view, list)
- Create: `packages/web/src/api/hooks/useDocuments.ts`
- Create: `packages/web/src/pages/Documents.tsx`

- [ ] **Step 1: Implement documentService** — CRUD, versioning, diffing, collections
- [ ] **Step 2: Implement document API routes** — all from scaffold
- [ ] **Step 3: Implement Discord commands** — `/doc search|view|list`
- [ ] **Step 4: Implement webapp document browser**
- [ ] **Step 5: Commit**

---

## Chunk 5: Voting & Offices (Phase 5)

### Task 14: Voting System + Tally Algorithms

**Files:**
- Create: `packages/api/src/services/voteService.ts`
- Create: `packages/api/src/services/tallying/index.ts`
- Create: `packages/api/src/services/tallying/fptp.ts`
- Create: `packages/api/src/services/tallying/yeaNay.ts`
- Create: `packages/api/src/services/tallying/rankedChoice.ts`
- Create: `packages/api/src/services/tallying/stv.ts`
- Create: `packages/api/src/services/tallying/approval.ts`
- Create: `packages/api/src/services/tallying/proportional.ts`
- Create: `packages/api/src/services/tallying/twoRoundRunoff.ts`
- Create: `packages/api/src/services/tallying/exhaustiveBallot.ts`
- Create: `packages/api/src/routes/voting.ts`
- Create: `packages/bot/src/commands/vote/*.ts`
- Create: `packages/bot/src/components/voteButtons.ts`
- Create: `packages/web/src/api/hooks/useVoting.ts`
- Create: `packages/web/src/pages/Voting.tsx`
- Create: `packages/web/src/pages/ElectionDetail.tsx`

- [ ] **Step 1: Implement TallyStrategy interface and all 8 tallying algorithms** (with tests!)
- [ ] **Step 2: Implement voteService** — election lifecycle, ballot casting, tallying, runoff creation, NPC confirmation
- [ ] **Step 3: Implement voting API routes** — all from scaffold
- [ ] **Step 4: Implement Discord commands** — `/vote create|cast|results|schedule|info|rounds`, `/elect`, `/candidate submit|list`, `/npc-confirm`
- [ ] **Step 5: Implement webapp voting pages** — election manager, ballot UI, results visualisation with vote bars
- [ ] **Step 6: Commit**

### Task 15: Office System + PM Appointments

**Files:**
- Create: `packages/api/src/services/officeService.ts`
- Create: `packages/api/src/routes/offices.ts`
- Create: `packages/bot/src/commands/office/*.ts`
- Create: `packages/web/src/api/hooks/useOffices.ts`
- Create: `packages/web/src/pages/Offices.tsx`

- [ ] **Step 1: Implement officeService** — appointments, removals, Discord role sync, confirmation votes, holder history
- [ ] **Step 2: Implement office API routes** — all from scaffold
- [ ] **Step 3: Implement Discord commands** — `/office list|info|history`, `/appoint`, `/dismiss`
- [ ] **Step 4: Implement webapp office management page**
- [ ] **Step 5: Commit**

---

## Chunk 6: Favours + Moderation + Polish (Phase 5b + 6)

### Task 16: Favours System

**Files:**
- Create: `packages/api/src/services/favourService.ts`
- Create: `packages/api/src/routes/favours.ts`
- Create: `packages/bot/src/commands/favours/*.ts`
- Create: `packages/web/src/api/hooks/useFavours.ts`
- Create: `packages/web/src/pages/Favours.tsx`

- [ ] **Step 1: Implement favourService** — categories CRUD, balance management, transaction logging
- [ ] **Step 2: Implement favours API routes** — all from scaffold
- [ ] **Step 3: Implement Discord commands** — `/favours`, `/favour grant|spend|remove|check|history|categories|category`
- [ ] **Step 4: Implement webapp favours dashboard** — matrix table for staff, bar charts for players
- [ ] **Step 5: Commit**

### Task 17: Moderation System

**Files:**
- Create: `packages/api/src/services/modService.ts`
- Create: `packages/api/src/routes/moderation.ts`
- Create: `packages/bot/src/commands/mod/*.ts`
- Create: `packages/web/src/api/hooks/useModeration.ts`
- Create: `packages/web/src/pages/Moderation.tsx`

- [ ] **Step 1: Implement modService** — actions, notes, history, appeal handling
- [ ] **Step 2: Implement moderation API routes** — all from scaffold
- [ ] **Step 3: Implement Discord commands** — `/mod warn|note|history|suspend|unsuspend`
- [ ] **Step 4: Implement webapp mod panel**
- [ ] **Step 5: Commit**

### Task 18: Dashboard + Activity Feed

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`
- Modify: `packages/web/src/pages/Dashboard.tsx`
- Create: `packages/web/src/components/dashboard/MetricCards.tsx`
- Create: `packages/web/src/components/dashboard/ActivityFeed.tsx`

- [ ] **Step 1: Implement dashboard API** — aggregate stats across all systems
- [ ] **Step 2: Implement dashboard page** — metric card grid + activity feed with system colour dots
- [ ] **Step 3: Commit**

### Task 19: Player Dossier Page (Webapp)

**Files:**
- Create: `packages/web/src/pages/CharacterDossier.tsx`
- Create: `packages/web/src/components/players/DossierHeader.tsx`
- Create: `packages/web/src/components/players/DossierTabs.tsx`
- Create: `packages/web/src/components/players/VotingRecord.tsx`
- Create: `packages/web/src/components/players/LegislativeRecord.tsx`
- Create: `packages/web/src/components/players/FavourChart.tsx`
- Create: `packages/web/src/components/players/EventTimeline.tsx`
- Create: `packages/web/src/pages/Players.tsx`

- [ ] **Step 1: Implement dossier header** — portrait, name, tags, health, bio
- [ ] **Step 2: Implement tabbed sections** — Overview, Offices, Legislation, Votes, Favours, History
- [ ] **Step 3: Implement deceased state** — greyscale portrait, graveyard bar
- [ ] **Step 4: Implement player list/registry page**
- [ ] **Step 5: Commit**

---

## Chunk 7: Webapp Feature Pages (remaining)

### Task 20: Graveyard Page

**Files:**
- Create: `packages/web/src/pages/Graveyard.tsx`
- Create: `packages/web/src/components/players/ObituaryCard.tsx`

- [ ] **Step 1: Implement graveyard page** — memorial list with obituary cards
- [ ] **Step 2: Commit**

### Task 21: Election Results Visualisation

**Files:**
- Create: `packages/web/src/components/voting/ResultsBars.tsx`
- Create: `packages/web/src/components/voting/RoundResults.tsx`
- Create: `packages/web/src/components/shared/StatusTimeline.tsx`

- [ ] **Step 1: Implement vote result bars** — horizontal stacked bars (yea/nay/abstain)
- [ ] **Step 2: Implement multi-round results display**
- [ ] **Step 3: Implement status timeline component** — reusable for bills and elections
- [ ] **Step 4: Commit**

### Task 22: Pagination + Shared Components

**Files:**
- Create: `packages/web/src/components/shared/Pagination.tsx`
- Create: `packages/web/src/components/shared/Tag.tsx`
- Create: `packages/web/src/components/shared/DataTable.tsx`
- Create: `packages/web/src/components/shared/MetricCard.tsx`
- Create: `packages/web/src/components/shared/SkeletonLoader.tsx`
- Create: `packages/bot/src/components/paginationButtons.ts`

- [ ] **Step 1: Implement shared UI components** — tags/badges, data tables, metric cards, skeleton loaders
- [ ] **Step 2: Implement Discord pagination** — paginated embeds with buttons
- [ ] **Step 3: Commit**

---

## Execution Notes

- **Build order matters.** Chunks 1-2 must complete before 3+. Chunks 3-6 can partially parallelise (e.g. tickets and bills can be built concurrently).
- **The scaffold document (`dps-scaffold.md`) has exact field definitions, schema code, route specs, and command signatures.** Always reference it for details.
- **Bot display name is configurable** via `BOT_DISPLAY_NAME` env var (defaults to "Hansard"). Use this in all branding, ready messages, embed footers. Package name is `hansard`.
- **Design system is non-negotiable** — warm cream backgrounds, serif typography (Crimson Pro + Lora), terracotta accents. No SaaS aesthetics. See scaffold "Aesthetic Guidelines" section.
- **The bot is a ledger, not an enforcer** — it tracks and assists, it doesn't enforce process.
