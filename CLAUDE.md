# Hansard — DPS Season Manager

A Discord bot + Fastify API + React webapp for managing Dynamic Political Simulation seasons.

## Project Structure

TypeScript monorepo with pnpm workspaces:

```
hansard/
├── packages/
│   ├── db/       — Drizzle ORM schema + PostgreSQL migrations
│   ├── shared/   — Shared types, constants, status enums, permissions
│   ├── bot/      — discord.js v14 Discord bot (~40 slash commands)
│   ├── api/      — Fastify v5 REST API with service layer
│   └── web/      — React 18 + Vite + TanStack Router SPA
├── docker-compose.yml
├── dps-scaffold.md   — Full architecture spec (authoritative reference)
└── .env.example      — Required environment variables
```

## Commands

```bash
# Development
pnpm dev:bot          # Start bot (tsx watch)
pnpm dev:api          # Start API (tsx watch)
pnpm dev:web          # Start webapp (Vite dev server)

# Database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:push          # Push schema directly to database
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio GUI

# Build
pnpm build            # Build all packages

# Docker
docker compose up -d  # Start PostgreSQL + all services
```

## Stack

Node.js 20+, TypeScript (strict, ES2022), pnpm workspaces, PostgreSQL 16, Drizzle ORM, discord.js v14, Fastify v5, React 18, Vite 6, TanStack Router + Query, Zustand, Tailwind CSS 3, Docker Compose.

## Key Design Decisions

- **The bot is a ledger, not an enforcer.** It tracks what's happening, helps find information, automates tedious bits. The actual political gameplay stays fluid and human-driven.
- **Bot display name is configurable** via `BOT_DISPLAY_NAME` env var (defaults to "Hansard").
- **Warm serif aesthetic** — Crimson Pro for headings, Lora for body text, JetBrains Mono for data. No sans-serif body text. Warm cream backgrounds, terracotta accent. Parliamentary record feel, not SaaS.
- **Voting algorithms** use a strategy pattern (`TallyStrategy` interface) for 8 methods: FPTP, ranked choice, STV, approval, proportional, yea/nay, two-round runoff, exhaustive ballot.
- **Circular DB references** — some cross-table references (bills↔elections, players↔offices) are stored as plain uuid columns without FK constraints to avoid circular import issues. Linked at query time.
- **JSONB for flexible data** — election configs, NPC votes, health ailments, favour transactions use JSONB columns.
- **Audit trails everywhere** — `playerEventLog`, `billStatusLog`, `ticketAuditLog`, `timeAdvanceLog` tables track all consequential actions.

## Architecture Overview

### Database (`packages/db`)

Schema files in `src/schema/`:

| File | Tables |
|------|--------|
| `players.ts` | `players`, `playerEventLog`, `factions`, `parties`, `offices`, `officeHolders` |
| `laws.ts` | `documentCollections`, `bills`, `billStatusLog`, `documents`, `documentVersions` |
| `voting.ts` | `elections`, `candidates`, `ballots` |
| `simulation.ts` | `simulationClock`, `timeAdvanceLog` |
| `tickets.ts` | `ticketCategories`, `tickets`, `ticketMessages`, `ticketAuditLog` |
| `favours.ts` | `favourCategories`, `favourBalances`, `favourTransactions` |
| `moderation.ts` | `modActions`, `modNotes` |

Config: `drizzle.config.ts` — uses glob pattern for schema files, PostgreSQL connection from `DATABASE_URL`.

### API (`packages/api`)

**Route plugins** registered in `src/app.ts` (all prefixed `/api/`):
- `auth` — Discord OAuth2 flow, session management
- `dashboard` — Overview stats
- `players` — Player CRUD, character creation, events, health
- `bills` — Bill submission (not in routes dir, handled via voting/documents)
- `voting` — Elections, candidates, ballots, result tallying
- `offices` — Office listings, appointments, dismissals
- `favours` — Categories, balances, transactions
- `tickets` — Ticket CRUD, assignment, status
- `moderation` — Mod actions, appeals, notes
- `simulation` — Time advancement, aging, ailments, deaths

**Service layer** in `src/services/` — one service per domain. Tallying strategies in `src/services/tallying/` (8 strategy files).

**Plugins** in `src/plugins/`: `auth.ts`, `db.ts`, `cors.ts`, `rateLimit.ts`.

**Middleware** in `src/middleware/`: `requireAuth`, `requireStaff`, `requireRole`.

**Auth pattern**: Discord OAuth2 → session cookie (7-day, httpOnly, sameSite=lax). Session user at `request.session.user`.

### Bot (`packages/bot`)

**Dynamic command loading** — recursive scan of `src/commands/` directory. Each command exports `{ data: SlashCommandBuilder, execute: Function }`.

**Command categories** (~40 commands):
- Bills (submit, list, search, view, vote, npc-vote, amend)
- Voting (create, elect, schedule, cast, results, npc-confirm)
- Players (character create, lookup, party change, history)
- Offices (list, info, appoint, dismiss)
- Favours (balance, categories, grant, spend, history)
- Tickets (create, list, view, assign, close)
- Documents (list, search, view)
- Simulation (time advance, ailment add, kill)
- Moderation (mod actions)
- Utilities (ping)

**Events** in `src/events/`: `ready.ts`, `interactionCreate.ts`.
**Components** in `src/components/`: `voteButtons.ts`, `ticketButtons.ts`, `ticketModals.ts`.
**Client intents**: Guilds, GuildMessages, GuildMembers, MessageContent, GuildMessageReactions.

### Web (`packages/web`)

**TanStack Router** with typed routes. **React Query** for server state. **Zustand** for client state.

**Pages** in `src/pages/`:
- `Dashboard`, `Login`, `Bills`, `BillDetail`, `Documents`
- `Voting`, `ElectionDetail`, `Offices`, `Players`, `CharacterDossier`
- `Tickets`, `TicketDetail`, `Moderation`, `Graveyard`
- `Favours`, `Simulation` (staff-only)

**Layout**: `Shell.tsx` (root layout) + `Sidebar.tsx` (navigation).

**Shared components** in `src/components/shared/`: `DataTable`, `MetricCard`, `StatusTimeline`, `ResultsBars`, `RedlineDiff`, `Pagination`, `SkeletonLoader`, `Tag`.

**API client**: `src/api/client.ts` (TanStack Query setup) + domain hooks in `src/api/hooks/` (one file per domain).

**Vite config**: React plugin, API proxy to `http://localhost:3001/api`.

### Shared (`packages/shared`)

**Status enums** (`constants/statuses.ts`): `BillStatus`, `ElectionStatus`, `ElectionType`, `VotingMethod`, `MajorityType`, `HealthStatus`, `AilmentSeverity`, `ModActionType`, `OfficeTier`, `OfficeFilledBy`, `AppointmentMethod`, `FavourTransactionType`, `PlayerEventType`, `DocumentType`.

**Config** (`constants/config.ts`): `DEFAULT_BOT_NAME`, `EMOJI`, `EMBED_COLOURS`, `COLOURS`, `STATUS_COLOURS`, `HEALTH_COLOURS`.

**Permissions** (`constants/permissions.ts`): `PERMISSIONS`, `StaffRole`, `hasStaffLevel()`, `hasPermission()`.

**Types** (`types/`): One file per domain — `voting.ts`, `bills.ts`, `players.ts`, `tickets.ts`, `favours.ts`, `moderation.ts`, `simulation.ts`.

## Environment Variables

See `.env.example` for the full list. Key groups:

| Group | Variables |
|-------|-----------|
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `BOT_DISPLAY_NAME` |
| Database | `DATABASE_URL` |
| API | `API_PORT` (3001), `API_HOST` (0.0.0.0), `API_URL`, `SESSION_SECRET` |
| Web | `WEB_PORT` (5173), `VITE_API_URL` |
| Channels | `TICKET_CHANNEL_ID`, `ANNOUNCEMENT_CHANNEL_ID`, `VOTING_CHANNEL_ID`, `MOD_LOG_CHANNEL_ID`, `GRAVEYARD_CHANNEL_ID`, `LEGISLATION_CHANNEL_ID` |
| Optional | `REDIS_URL`, `FRONTEND_URL`, `LOG_LEVEL`, `NODE_ENV` |

## Conventions for AI Assistants

### Code Style
- TypeScript strict mode throughout. Use explicit types at module boundaries; infer locally.
- Fastify routes use plugin pattern with `fp()` wrapper. Register in `app.ts`.
- Bot commands follow the `Command` interface (`data` + `execute`). Place in appropriate subdirectory under `src/commands/`.
- Database changes: edit schema files, then run `pnpm db:generate` and `pnpm db:push`.
- Import from workspace packages as `@hansard/db`, `@hansard/shared`.

### Design System (Web)
- **Never use sans-serif body text.** Use `font-body` (Lora) for text, `font-display` (Crimson Pro) for headings, `font-mono` (JetBrains Mono) for data.
- Warm cream backgrounds (`bg-page`), terracotta accents. No blue-grey SaaS aesthetics.
- Use semantic Tailwind tokens defined in `tailwind.config.ts`.
- Domain colour conventions: Bills (terracotta), Voting (blue), Players (sage), Offices (purple).

### What to Avoid
- Don't add FK constraints for circular references (bills↔elections, players↔offices) — use plain UUID columns.
- Don't enforce gameplay rules in code — the bot tracks, it doesn't gatekeep.
- No test infrastructure exists yet — don't assume test runners are available.
- No CI/CD pipeline — don't reference GitHub Actions or automated checks.

## Full Spec

See `dps-scaffold.md` for the complete architecture document with all schemas, routes, commands, and design guidelines.
