# DPS Season Manager — Architecture & Scaffold

## Overview

A Discord bot + web application for managing Dynamic Political Simulation seasons.
The bot is a **ledger and assistant**, not a process enforcer — it tracks what's happening,
helps staff and players find information, and automates the tedious bits (role sync, vote tallying,
aging rolls). The actual political gameplay stays fluid and human-driven.

Core systems: Tickets/CRM, Bill Registry, Voting, Player Registry, Offices, Favours, Simulation Clock, Moderation.

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20+ (TypeScript) | discord.js is native JS; single-language stack |
| API Framework | Fastify | Faster than Express, great TS support, schema validation built in |
| Discord | discord.js v14 | Industry standard, slash commands, buttons, modals, threads |
| Database | PostgreSQL 16 | Relational model fits the domain perfectly; full-text search; JSONB for flexible fields |
| ORM | Drizzle ORM | Lightweight, SQL-like, excellent TS inference, good migration story |
| Frontend | React 18 + Vite + TanStack Router | SPA dashboard, no SSR needed |
| UI Library | Tailwind CSS + shadcn/ui | Consistent design system, accessible components |
| Auth | Discord OAuth2 | Players already have Discord accounts; use for webapp login |
| Deployment | Docker Compose | Self-hostable; easy to deploy to Railway/Fly.io later |

---


## Aesthetic Guidelines — "The Ledger"

### Design Philosophy

This is a **political ledger** — warm, literate, quietly authoritative.
The aesthetic draws from Anthropic's design language: warm cream backgrounds, earthy accents,
serif typography that feels like reading a well-typeset document. It should feel like a
beautifully maintained parliamentary record — not a SaaS dashboard, not a gaming UI.

Think: **a private secretary's notebook, digitised.** Clean, warm, information-dense but never
oppressive. Players will stare at this for hours during legislative sessions — it needs to be
*comfortable*, not dramatic.

**Core principles:**
- **Warm over cold** — cream backgrounds, earthy tones, terracotta accents. No blue-grey SaaS void.
- **Readable at length** — serif body text, generous line height, high contrast. This is for reading, not scanning.
- **Quiet authority** — hierarchy through typography and spacing, not colour saturation. Let the data be dramatic; the UI stays composed.
- **Light by default** — natural light mode as primary. Dark mode available but secondary.

### Colour System

Rooted in Anthropic's palette — warm neutrals with earthy, muted accents.
Each system gets a colour identity, but they're all desaturated enough to coexist peacefully.

```css
:root {
  /* === BASE (light mode) === */
  --bg-page: #FAF9F5;               /* warm cream — the paper */
  --bg-card: #FFFFFF;                /* clean white — elevated surfaces */
  --bg-inset: #F2F0E8;              /* slightly warm grey — inset panels, code blocks */
  --bg-hover: #EDEADF;              /* hover state */
  --border-subtle: #E8E6DC;         /* hairline dividers */
  --border-default: #D4D1C7;        /* visible borders */
  --border-strong: #B0AEA5;         /* emphasis borders */
  
  /* === TEXT === */
  --text-primary: #141413;          /* near-black, warm */
  --text-secondary: #524F48;        /* warm dark grey — supporting text (WCAG AA on white) */
  --text-tertiary: #7A7770;         /* muted — timestamps, metadata */
  --text-inverse: #FAF9F5;          /* text on dark backgrounds */
  
  /* === PRIMARY ACCENT === */
  --accent-primary: #D97757;        /* Anthropic terracotta/orange — the signature colour */
  --accent-primary-light: #F5E6DF;  /* tinted background for primary highlights */
  
  /* === SYSTEM ACCENTS — muted, earthy === */
  --accent-bills: #C4873B;          /* warm amber — legislation */
  --accent-voting: #6A9BCC;         /* dusty blue — democracy */
  --accent-players: #788C5D;        /* sage green — the living */
  --accent-offices: #9B7CB8;        /* muted lavender — authority */
  --accent-favours: #C4873B;        /* same amber as bills — political currency */
  --accent-tickets: #7B8BA8;        /* slate blue — administration */
  --accent-moderation: #C25B4E;     /* brick red — judgement */
  --accent-graveyard: #9C9890;      /* warm grey — memory */
  --accent-simulation: #5D8C7B;     /* teal-green — the passage of time */
  
  /* === STATUS COLOURS === */
  --status-open: #6A9BCC;
  --status-active: #788C5D;
  --status-pending: #C4873B;
  --status-closed: #9C9890;
  --status-rejected: #C25B4E;
  --status-passed: #788C5D;
  --status-deceased: #B0AEA5;
  
  /* === HEALTH INDICATORS === */
  --health-healthy: #788C5D;
  --health-minor: #C4873B;
  --health-major: #D97757;
  --health-critical: #C25B4E;
}

/* === DARK MODE === */
[data-theme="dark"] {
  --bg-page: #1A1918;
  --bg-card: #242320;
  --bg-inset: #2C2B27;
  --bg-hover: #33322D;
  --border-subtle: #3A3935;
  --border-default: #4A4943;
  --border-strong: #6B6860;
  
  --text-primary: #F2F0E8;
  --text-secondary: #B0AEA5;
  --text-tertiary: #7A7770;
}
```

**Usage rules:**
- The terracotta (`--accent-primary` / `#D97757`) is the signature colour. Use it for: the active sidebar indicator, primary action buttons, and the most important interactive elements. Sparingly.
- System accents appear as **left border accents** on cards (3px), **tag text/borders**, and **icon tints** — never as large fills.
- Backgrounds should always be warm. No pure white (#FFF) in dark mode, no blue-grey anywhere.
- Status colours override system accents when status is the primary information.

### Typography

**Display / Headings:** `Crimson Pro` — a sharp, high-contrast serif with real character.
Parliamentary gravitas without being stuffy. Use weight 600 for display, 500 for subheadings.
Import from Google Fonts. This is the face of the app — every page title, every bill name,
every player character name is in Crimson Pro.

**Body / Long-form text:** `Lora` — a warm, contemporary serif. Excellent readability at
long lengths, which matters when players are reading bill content, event logs, and obituaries.
Use regular (400) for body, medium (500) for emphasis. Import from Google Fonts.

**Labels / Functional UI:** `Lora` also, at smaller sizes with medium weight and letter-spacing.
Keeping everything serif creates a cohesive, literary feel. The only sans-serif in the system
is the monospace.

**Monospace / Data:** `JetBrains Mono` — for bill numbers, ticket IDs, vote tallies, timestamps.
The "ledger entry" typeface. Regular weight only.

**Discord embeds:** replicate hierarchy with:
- **Bold** for titles and names
- `Code blocks` for IDs, numbers, and data
- Consistent emoji prefixes per system (see Discord section)
- `> quote blocks` for summaries and descriptions

```css
/* Type scale */
.text-display    { font: 600 1.75rem/1.2 'Crimson Pro', serif; letter-spacing: -0.01em; }
.text-heading-1  { font: 600 1.25rem/1.3 'Crimson Pro', serif; }
.text-heading-2  { font: 500 1rem/1.4 'Crimson Pro', serif; }
.text-body       { font: 400 0.9375rem/1.7 'Lora', serif; }      /* 15px — slightly larger for serif */
.text-body-sm    { font: 400 0.875rem/1.6 'Lora', serif; }
.text-label      { font: 500 0.75rem/1.4 'Lora', serif; letter-spacing: 0.03em; text-transform: uppercase; }
.text-mono       { font: 400 0.8125rem/1.5 'JetBrains Mono', monospace; }
```

### Layout & Components

**Sidebar navigation:** fixed left, 220px (collapses to 56px on mobile).
Warm cream background (`--bg-page`), with a thin right border.
Active item has a 3px left border in `--accent-primary` (terracotta).
Section headers in `text-label` style. Icons + text labels in `text-body-sm`.
Feels like a table of contents.

**Cards:** white (`--bg-card`) with a 1px `--border-subtle` border and a **3px left border** in
the system accent colour. Gentle corner radius (6px). On hover: border shifts to `--border-default`.
No shadows except on modals/dropdowns (subtle: `0 4px 12px rgba(20, 20, 19, 0.08)`).

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--accent-bills); /* changes per system */
  border-radius: 6px;
  padding: 16px 20px;
  transition: border-color 150ms ease;
}
.card:hover {
  border-color: var(--border-default);
}
```

**Tables:** clean, minimal. No alternating row backgrounds — instead, use a 1px `--border-subtle`
bottom border on each row. Column headers in `text-label` style (uppercase, small, Lora medium).
Data in `text-mono` for numbers, `text-body-sm` (Lora) for text. Generous row padding (12px vertical).

**Tags / Badges:** pill-shaped with tinted backgrounds. Use the system accent at ~8% opacity for
background, the full accent for text and a subtle border.
```css
.tag {
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  font: 500 0.6875rem/1 'Lora', serif;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 99px;
}
```

**Status timeline:** vertical for bill/election lifecycle. Connected dots with thin lines.
Current stage has a filled dot + terracotta ring. Past stages are `--text-tertiary`.
Future stages are `--border-subtle`. Clean, typographic — no icons in the dots.

**Vote result bars:** horizontal stacked bars — sage green for yea, brick red for nay,
warm grey for abstain. Rounded ends (4px). Numbers inside the bars when there's room,
next to them when there isn't. The bar should feel weighty — 28px tall minimum.

**Primary action button:** terracotta background, warm cream text.
```css
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-inverse);
  font: 500 0.875rem/1 'Crimson Pro', serif;
  padding: 10px 20px;
  border-radius: 6px;
  border: none;
  transition: opacity 150ms;
}
.btn-primary:hover { opacity: 0.9; }
```

### Page-Specific Aesthetics

**Dashboard:** a grid of metric cards on the cream background. Each card shows a large monospace number
in the system accent colour, with a `text-label` descriptor above. An activity feed below/right
showing recent events, each with a small colour dot for the system, a timestamp, and a brief description.
The whole page should feel like opening the morning briefing.

**Bill Detail:** the centrepiece.
1. **Header**: bill number in `text-mono`, title in `text-display`, status badge.
   A prominent "Open in Google Docs" button (terracotta outline style).
2. **Metadata**: author (linked), co-sponsors, submitted date, policy area tags. All in a single line.
3. **Status timeline**: horizontal, compact, below the metadata.
4. **Content area**: two columns — left is the cached bill content in `text-body` (Lora, the reading serif),
   right is a sidebar with vote record, NPC house result, estimated effects.
5. **Vote breakdown**: expandable list of yea/nay/abstain with player names, each linked to their profile.

**Player Dossier (Character Sheet):** the most characterful page.
- Header: character portrait (large, left-aligned — or serif initials circle if no portrait uploaded).
  Character name in `text-display` (Crimson Pro), with party/faction tags, current office badges, and a
  health status dot (sage green = healthy, amber = ailment, red = critical).
  Age, registration date, brief bio excerpt (expandable).
- Below: tabbed sections with `text-label` tab headers — Overview, Offices, Legislation, Votes, Favours, History.
- The dossier is the complete intelligence file on a character — everything they've done, every vote
  they've cast, every office they've held, every favour they've accumulated.
- If deceased: portrait gets subtle greyscale filter, thin `--accent-graveyard` bar across the top with
  "Deceased — [cause], age [X]" in italic Lora. All data remains accessible.

**Favours page:** for staff, a matrix table — rows are players, columns are favour categories.
Cells show the balance number, with a subtle background tint that gets warmer (more amber) as the
value increases. For individual players, a horizontal bar chart showing distribution across categories.

**Graveyard page (webapp):** list of all deceased characters, most recent first.
Each obituary is a card with the graveyard left-border accent (warm grey). The narrative is in
`text-body` (Lora, italic). Party and office tags underneath. Feels like a memorial book.

**Election results:** the results bar dominates. For close votes, the margin is shown in large
`text-mono`. For multi-round elections, each round is shown as a row with the bars adjusting
and eliminated candidates greyed out.

### Discord Embed Styling

**System emoji prefixes:**
- 📋 Tickets
- 📜 Bills / Legislation
- 🗳️ Voting / Elections
- 👤 Players
- 🏛️ Offices
- 🤝 Favours
- ⚰️ Graveyard / Deaths
- ⏳ Simulation / Time
- 🔨 Moderation

**Embed colours (Discord hex):**
- Bills: `#C4873B`
- Voting: `#6A9BCC`
- Players: `#788C5D`
- Offices: `#9B7CB8`
- Favours: `#C4873B`
- Graveyard: `#9C9890`
- Tickets: `#7B8BA8`
- Moderation: `#C25B4E`
- Simulation: `#5D8C7B`

**Embed structure conventions:**
- Title line: emoji + bold title
- Use inline fields for metadata — three per row max
- Use code blocks for IDs, numbers, tallies: `` `Bill #014` ``, `` `Yea: 12 | Nay: 8 | Abs: 3` ``
- Use `> quote blocks` for summaries and bill descriptions
- Footer: timestamp + "View in webapp →" with link

**Graveyard obituary embeds:**
- Embed colour: `#9C9890` (warm grey)
- Title: `⚰️ [CHARACTER NAME] (Birth Year — Death Year)`
- Fields: Cause of Death, Age, Party History, Offices Held, Legislative Record, Final Favours
- Narrative paragraph in italics
- Footer: `Rest in peace.` + death sim-date

**Vote embeds:**
- Opening: dusty blue, ballot emoji, deadline in bold
- Closing: result colour (sage green / brick red), large tally display
- Elections: winner announced with office emoji

### Transitions & Micro-interactions

- **Page transitions**: fade (120ms). Clean, barely noticeable.
- **Card hover**: border darkens one step. No transforms, no shadows.
- **Vote tallying**: bars grow from left to right over ~400ms, staggered by 50ms. Ease-out curve.
- **Status badge update**: brief background-colour pulse (200ms) when a status changes.
- **Favour balance change**: number does a subtle count-up/down over 300ms.
- **Timeline current stage**: gentle opacity pulse on the dot (CSS animation, 2s loop). No box-shadow glow.
- **Skeleton loading**: single horizontal shimmer sweep, warm-toned (cream to slightly lighter cream).

### Design System Tokens (Tailwind config)

```javascript
// tailwind.config.ts
{
  theme: {
    extend: {
      colors: {
        page: '#FAF9F5',
        card: '#FFFFFF',
        inset: '#F2F0E8',
        accent: {
          primary: '#D97757',
          'primary-light': '#F5E6DF',
          bills: '#C4873B',
          voting: '#6A9BCC',
          players: '#788C5D',
          offices: '#9B7CB8',
          favours: '#C4873B',
          tickets: '#7B8BA8',
          moderation: '#C25B4E',
          graveyard: '#9C9890',
          simulation: '#5D8C7B',
        },
        text: {
          primary: '#141413',
          secondary: '#524F48',
          tertiary: '#7A7770',
          inverse: '#FAF9F5',
        },
        border: {
          subtle: '#E8E6DC',
          default: '#D4D1C7',
          strong: '#B0AEA5',
        },
      },
      fontFamily: {
        display: ['"Crimson Pro"', 'serif'],
        body: ['Lora', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '6px',
      },
      fontSize: {
        'display': ['1.75rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'heading-1': ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        'heading-2': ['1rem', { lineHeight: '1.4', fontWeight: '500' }],
        'body': ['0.9375rem', { lineHeight: '1.7' }],
        'body-sm': ['0.875rem', { lineHeight: '1.6' }],
        'label': ['0.75rem', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.03em' }],
      },
    },
  },
}
```

### What to Avoid

- **No sans-serif body text** — everything except monospace data is serif (Crimson Pro or Lora). The literary feel is the whole identity.
- **No heavy font weights** — max is 600 for display headings. Body text stays at 400.
- **No cold blues/greys as backgrounds** — everything stays warm. No #F5F5F5 or #F8FAFC.
- **No saturated accent fills** — accent colours are for text, borders, and small indicators. Never fill a card with a saturated colour.
- **No box shadows on cards** — only on modals and dropdowns. Cards use borders, not shadows.
- **No rounded corners larger than 6px** — except on pills/badges (which use 99px for full-round).
- **No skeleton loaders with grey backgrounds** — use the warm cream shimmer.
- **No generic SaaS aesthetics** — no blue CTAs, no Inter/Roboto/Poppins, no grey sidebars, no card shadows.
- **No Discord embeds longer than ~15 fields** — paginate or link to webapp.

---

## Project Structure

```
dps-manager/
├── docker-compose.yml
├── package.json                    # Workspace root (pnpm workspaces)
├── packages/
│   ├── db/                         # Shared database package
│   │   ├── src/
│   │   │   ├── schema/             # Drizzle schema definitions
│   │   │   │   ├── tickets.ts
│   │   │   │   ├── laws.ts
│   │   │   │   ├── voting.ts
│   │   │   │   ├── players.ts
│   │   │   │   ├── moderation.ts
│   │   │   │   ├── simulation.ts
│   │   │   │   ├── favours.ts
│   │   │   │   └── index.ts
│   │   │   ├── migrations/
│   │   │   ├── seed.ts
│   │   │   └── index.ts            # Exports drizzle client + schema
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   │
│   ├── shared/                     # Shared types, utils, constants
│   │   ├── src/
│   │   │   ├── types/              # Shared TypeScript types (API responses, enums)
│   │   │   ├── constants/          # Status enums, category definitions, config
│   │   │   └── utils/              # Shared utility functions
│   │   └── package.json
│   │
│   ├── bot/                        # Discord bot
│   │   ├── src/
│   │   │   ├── index.ts            # Bot entrypoint
│   │   │   ├── client.ts           # Discord client setup
│   │   │   ├── commands/           # Slash command definitions
│   │   │   │   ├── tickets/
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── assign.ts
│   │   │   │   │   ├── close.ts
│   │   │   │   │   ├── list.ts
│   │   │   │   │   └── view.ts
│   │   │   │   ├── bills/
│   │   │   │   │   ├── submit.ts
│   │   │   │   │   ├── submitFor.ts
│   │   │   │   │   ├── view.ts
│   │   │   │   │   ├── search.ts
│   │   │   │   │   ├── vote.ts
│   │   │   │   │   ├── npcVote.ts
│   │   │   │   │   └── list.ts
│   │   │   │   ├── docs/
│   │   │   │   │   ├── search.ts
│   │   │   │   │   ├── view.ts
│   │   │   │   │   └── list.ts
│   │   │   │   ├── vote/
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── cast.ts
│   │   │   │   │   ├── results.ts
│   │   │   │   │   ├── elect.ts
│   │   │   │   │   ├── npcConfirm.ts
│   │   │   │   │   └── schedule.ts
│   │   │   │   ├── office/
│   │   │   │   │   ├── list.ts
│   │   │   │   │   ├── info.ts
│   │   │   │   │   ├── appoint.ts
│   │   │   │   │   └── dismiss.ts
│   │   │   │   ├── player/
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── edit.ts
│   │   │   │   │   ├── view.ts
│   │   │   │   │   ├── lookup.ts
│   │   │   │   │   ├── party.ts
│   │   │   │   │   └── history.ts
│   │   │   │   ├── simulation/
│   │   │   │   │   ├── time.ts
│   │   │   │   │   ├── ailment.ts
│   │   │   │   │   └── kill.ts
│   │   │   │   ├── favours/
│   │   │   │   │   ├── balance.ts
│   │   │   │   │   ├── grant.ts
│   │   │   │   │   ├── spend.ts
│   │   │   │   │   ├── history.ts
│   │   │   │   │   └── categories.ts
│   │   │   │   └── mod/
│   │   │   │       ├── warn.ts
│   │   │   │       ├── note.ts
│   │   │   │       ├── history.ts
│   │   │   │       └── suspend.ts
│   │   │   ├── events/             # Discord event handlers
│   │   │   │   ├── interactionCreate.ts
│   │   │   │   ├── messageCreate.ts
│   │   │   │   └── ready.ts
│   │   │   ├── components/         # Button/select menu/modal handlers
│   │   │   │   ├── ticketButtons.ts
│   │   │   │   ├── voteButtons.ts
│   │   │   │   ├── ticketModals.ts
│   │   │   │   └── paginationButtons.ts
│   │   │   └── utils/
│   │   │       ├── embeds.ts       # Standardised embed builders
│   │   │       ├── permissions.ts  # Role/permission checks
│   │   │       └── pagination.ts   # Paginated embeds helper
│   │   └── package.json
│   │
│   ├── api/                        # Fastify REST API
│   │   ├── src/
│   │   │   ├── index.ts            # Server entrypoint
│   │   │   ├── app.ts              # Fastify app setup, plugin registration
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts         # Discord OAuth2 + session management
│   │   │   │   ├── cors.ts
│   │   │   │   └── rateLimit.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts         # OAuth2 callback, session endpoints
│   │   │   │   ├── tickets.ts      # Full CRUD + workflow transitions
│   │   │   │   ├── bills.ts        # Bill submission, voting, NPC house
│   │   │   │   ├── documents.ts    # Static doc CRUD + versioning + search
│   │   │   │   ├── voting.ts       # Election/vote management + results + runoffs
│   │   │   │   ├── offices.ts      # Office management + appointments
│   │   │   │   ├── players.ts      # Player profiles + history + party changes
│   │   │   │   ├── simulation.ts   # Time advance, aging, ailments
│   │   │   │   ├── favours.ts      # Favour categories, balances, transactions
│   │   │   │   ├── moderation.ts   # Staff-only mod actions
│   │   │   │   └── dashboard.ts    # Aggregated stats/metrics
│   │   │   ├── middleware/
│   │   │   │   ├── requireAuth.ts
│   │   │   │   ├── requireStaff.ts
│   │   │   │   └── requireRole.ts  # Granular role-based access
│   │   │   └── services/           # Business logic layer
│   │   │       ├── ticketService.ts
│   │   │       ├── billService.ts       # Bill submission, status transitions
│   │   │       ├── documentService.ts   # Static docs, worldbuilding
│   │   │       ├── googleDocService.ts  # Fetch + cache Google Doc content
│   │   │       ├── voteService.ts       # Election lifecycle, tallying, runoffs
│   │   │       ├── officeService.ts     # Appointments, removals, role sync
│   │   │       ├── playerService.ts
│   │   │       ├── favourService.ts     # Favour grants, spends, balance management
│   │   │       ├── simulationService.ts # Time advance, aging, ailments, death
│   │   │       └── modService.ts
│   │   └── package.json
│   │
│   └── web/                        # React SPA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── router.tsx          # TanStack Router config
│       │   ├── api/                # API client (fetch wrapper + types)
│       │   │   ├── client.ts
│       │   │   └── hooks/          # TanStack Query hooks per domain
│       │   │       ├── useTickets.ts
│       │   │       ├── useBills.ts
│       │   │       ├── useDocuments.ts
│       │   │       ├── useVoting.ts
│       │   │       ├── useOffices.ts
│       │   │       ├── usePlayers.ts
│       │   │       ├── useFavours.ts
│       │   │       ├── useSimulation.ts
│       │   │       └── useModeration.ts
│       │   ├── components/
│       │   │   ├── layout/         # Shell, sidebar, nav, breadcrumbs
│       │   │   ├── tickets/        # Ticket list, detail, creation form
│       │   │   ├── bills/          # Bill browser, detail, effects panel
│       │   │   ├── documents/      # Worldbuilding/reference doc browser
│       │   │   ├── voting/         # Election manager, ballot UI, results viz
│       │   │   ├── players/        # Player profiles, registry, event log
│       │   │   ├── favours/        # Favour balances, transaction log, categories
│       │   │   ├── simulation/     # Time controls, aging dashboard
│       │   │   ├── moderation/     # Mod panel, action log
│       │   │   ├── dashboard/      # Overview cards, charts, activity feed
│       │   │   └── shared/         # Generic reusable components
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── Tickets.tsx
│       │   │   ├── TicketDetail.tsx
│       │   │   ├── Bills.tsx
│       │   │   ├── BillDetail.tsx
│       │   │   ├── Documents.tsx
│       │   │   ├── Voting.tsx
│       │   │   ├── ElectionDetail.tsx
│       │   │   ├── Offices.tsx
│       │   │   ├── Players.tsx
│       │   │   ├── CharacterDossier.tsx
│       │   │   ├── Favours.tsx
│       │   │   ├── Simulation.tsx
│       │   │   ├── Moderation.tsx
│       │   │   └── Login.tsx
│       │   ├── stores/             # Zustand stores for client state
│       │   └── utils/
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       └── package.json
│
├── .env.example
├── Dockerfile.bot
├── Dockerfile.api
├── Dockerfile.web
└── README.md
```

---

## Database Schema (Drizzle)

### Simulation Clock

```typescript
// packages/db/src/schema/simulation.ts

// The simulation clock tracks in-game time independently of real time.
// Staff advance time via /time advance command.
// Each tick can represent whatever unit the season uses (days, weeks, months, years).

export const simulationClock = pgTable('simulation_clock', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Current in-game date
  currentDate: varchar('current_date', { length: 32 }).notNull(),  // flexible format, e.g. "Year 4, Month 3" or "1923-06-15"
  currentTick: integer('current_tick').default(0).notNull(),         // monotonic counter
  
  // Configuration
  tickUnit: varchar('tick_unit', { length: 32 }).default('month').notNull(),  // 'day' | 'week' | 'month' | 'year'
  startDate: varchar('start_date', { length: 32 }).notNull(),
  
  // Season metadata
  seasonName: varchar('season_name', { length: 128 }).notNull(),
  isPaused: boolean('is_paused').default(false).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Log of every time advancement — what happened each tick
export const timeAdvanceLog = pgTable('time_advance_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  fromTick: integer('from_tick').notNull(),
  toTick: integer('to_tick').notNull(),
  fromDate: varchar('from_date', { length: 32 }).notNull(),
  toDate: varchar('to_date', { length: 32 }).notNull(),
  
  advancedById: uuid('advanced_by_id').references(() => players.id).notNull(),
  
  // Summary of what happened during this tick
  summary: jsonb('summary').$type<{
    deaths: string[];           // player IDs who died
    ailments: string[];         // player IDs who got new ailments
    aged: number;               // how many players aged
    // TODO: economy changes, popsim shifts
  }>(),
  
  notes: text('notes'),         // staff can add context
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Players

```typescript
// packages/db/src/schema/players.ts

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordId: varchar('discord_id', { length: 20 }).notNull().unique(),
  discordUsername: varchar('discord_username', { length: 64 }).notNull(),
  
  // === CHARACTER CREATION ===
  // Players create a character via /character create — fills in these fields.
  characterName: varchar('character_name', { length: 128 }),
  characterBio: text('character_bio'),                     // free-form biography/description
  characterPortraitUrl: varchar('character_portrait_url', { length: 512 }),
  // Player uploads an image to Discord or provides a URL. Stored for display in webapp/embeds.
  
  factionId: uuid('faction_id').references(() => factions.id),
  partyId: uuid('party_id').references(() => parties.id),
  
  // === AGING & LIFECYCLE ===
  birthDate: varchar('birth_date', { length: 32 }),     // in-sim date
  startingAge: integer('starting_age'),                   // the age they chose at character creation
  currentAge: integer('current_age'),                     // calculated on time advance
  deathDate: varchar('death_date', { length: 32 }),
  causeOfDeath: varchar('cause_of_death', { length: 256 }),
  isAlive: boolean('is_alive').default(true).notNull(),
  
  // Health / ailments
  healthStatus: varchar('health_status', { length: 32 }).default('healthy').notNull(),
  ailments: jsonb('ailments').$type<{
    condition: string;
    severity: 'minor' | 'major' | 'critical';
    acquiredAtTick: number;
    acquiredAtAge: number;
    notes?: string;
  }[]>().default([]),
  
  // === STARTING AGE FAVOUR BONUS ===
  // Older characters start with bonus favours but are closer to ailments/death.
  // The bonus is applied once at character creation and logged as a transaction.
  startingFavoursGranted: boolean('starting_favours_granted').default(false).notNull(),
  
  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isStaff: boolean('is_staff').default(false).notNull(),
  staffRole: varchar('staff_role', { length: 64 }),
  
  // Metadata
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at'),
  profileData: jsonb('profile_data').$type<{
    timezone?: string;
    pronouns?: string;
    [key: string]: unknown;
  }>(),
});

// === PLAYER EVENT LOG ===
// Tracks party changes, faction changes, office appointments, ailments, deaths — everything.
export const playerEventLog = pgTable('player_event_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  
  eventType: varchar('event_type', { length: 64 }).notNull(),
  // 'party_change' | 'faction_change' | 'office_appointed' | 'office_left'
  // | 'ailment_acquired' | 'ailment_recovered' | 'health_changed' | 'death'
  // | 'registration' | 'name_change' | 'suspension' | 'unsuspension'
  
  description: varchar('description', { length: 512 }).notNull(),
  
  // Flexible before/after for any change
  oldValue: jsonb('old_value'),  // e.g. { partyId: "...", partyName: "Liberal Democrats" }
  newValue: jsonb('new_value'),  // e.g. { partyId: "...", partyName: "Conservative Party" }
  
  // Context
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
  triggeredById: uuid('triggered_by_id').references(() => players.id),  // who/what caused it (self, staff, system)
  isAutomatic: boolean('is_automatic').default(false).notNull(),        // true if caused by time advance
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const factions = pgTable('factions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 16 }),
  description: text('description'),
  colour: varchar('colour', { length: 7 }),  // hex colour for embeds
  discordRoleId: varchar('discord_role_id', { length: 20 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 16 }),
  factionId: uuid('faction_id').references(() => factions.id),
  leaderId: uuid('leader_id').references(() => players.id),
  ideology: varchar('ideology', { length: 256 }),
  colour: varchar('colour', { length: 7 }),
  discordRoleId: varchar('discord_role_id', { length: 20 }),  // mapped Discord role for auto-sync
  isActive: boolean('is_active').default(true).notNull(),
  foundedAt: timestamp('founded_at').defaultNow().notNull(),
  dissolvedAt: timestamp('dissolved_at'),
});

export const offices = pgTable('offices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),       // e.g. "Prime Minister", "Chancellor", "Minister of War"
  tier: varchar('tier', { length: 32 }).notNull(),          // e.g. 'head_of_state', 'head_of_government', 'cabinet', 'legislature', 'regional'
  factionId: uuid('faction_id').references(() => factions.id), // null = cross-faction
  maxHolders: integer('max_holders').default(1).notNull(),
  
  // === PERMISSIONS ===
  // What this office can do in the bot/system
  permissions: jsonb('permissions').$type<string[]>(),
  // Available permissions:
  //   'legislative_leader'  — can create legislative votes, schedule bills, manage legislature
  //   'appoint_ministers'   — can appoint/remove holders of offices with appointable=true (PM power)
  //   'call_elections'      — can create position_election votes
  //   'executive_orders'    — can issue executive orders (future)
  //   'veto'                — can veto passed legislation (future)
  
  // === APPOINTMENT CONFIG ===
  // How this office is filled
  filledBy: varchar('filled_by', { length: 32 }).default('elected').notNull(),
  // 'elected'    — filled via position_election vote
  // 'appointed'  — filled by another office holder (e.g. PM appoints ministers)
  // 'succession' — filled automatically on vacancy (future)
  // 'staff'      — assigned directly by staff
  
  appointableBy: uuid('appointable_by').references((): any => offices.id),
  // If filledBy='appointed', which office can appoint to this one.
  // e.g. Minister of War has appointableBy = PM's office ID
  
  requiresConfirmation: boolean('requires_confirmation').default(false).notNull(),
  // If true, appointments/elections need NPC house confirmation before taking effect
  
  // === DISCORD ROLE ===
  discordRoleId: varchar('discord_role_id', { length: 20 }),
  // When a player is appointed/elected to this office, they get this Discord role.
  // When they leave, the role is removed.
  
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const officeHolders = pgTable('office_holders', {
  id: uuid('id').primaryKey().defaultRandom(),
  officeId: uuid('office_id').references(() => offices.id).notNull(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  startDate: timestamp('start_date').defaultNow().notNull(),
  endDate: timestamp('end_date'),
  
  // How they got here
  appointedBy: uuid('appointed_by').references(() => players.id),
  appointmentMethod: varchar('appointment_method', { length: 64 }).notNull(),
  // 'elected' | 'appointed' | 'succession' | 'staff_assigned'
  
  // Links to the election or confirmation vote if applicable
  electionId: uuid('election_id').references(() => elections.id),
  
  // Why they left (if endDate is set)
  removalReason: varchar('removal_reason', { length: 256 }),
  // 'resigned' | 'removed_by_appointer' | 'voted_out' | 'term_expired' | 'died' | 'impeached' | 'staff_removed'
  removedById: uuid('removed_by_id').references(() => players.id),
  
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
});
```

### Tickets

```typescript
// packages/db/src/schema/tickets.ts

export const ticketCategories = pgTable('ticket_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  emoji: varchar('emoji', { length: 8 }),
  colour: varchar('colour', { length: 7 }),
  
  // Which staff roles can see/handle this category
  assignableRoles: jsonb('assignable_roles').$type<string[]>().default([]),
  
  // Custom status pipeline for this category
  // If null, uses the default pipeline
  customPipeline: jsonb('custom_pipeline').$type<{
    statuses: { key: string; label: string; colour: string }[];
    transitions: Record<string, string[]>;  // which statuses can transition to which
  }>(),
  
  // Template fields players must fill out
  formTemplate: jsonb('form_template').$type<{
    fields: {
      key: string;
      label: string;
      type: 'text' | 'textarea' | 'select' | 'number' | 'date';
      required: boolean;
      options?: string[];  // for select type
      placeholder?: string;
    }[];
  }>(),
  
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: serial('number'),  // human-readable ticket number: #001, #002, etc.
  
  categoryId: uuid('category_id').references(() => ticketCategories.id).notNull(),
  
  // Who
  createdById: uuid('created_by_id').references(() => players.id).notNull(),
  assignedToId: uuid('assigned_to_id').references(() => players.id),
  
  // What
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  formData: jsonb('form_data'),  // filled-in template fields
  
  // Status
  status: varchar('status', { length: 32 }).default('open').notNull(),
  priority: varchar('priority', { length: 16 }).default('normal').notNull(),  // low, normal, high, urgent
  
  // Relationships
  parentTicketId: uuid('parent_ticket_id').references((): any => tickets.id),
  linkedTicketIds: jsonb('linked_ticket_ids').$type<string[]>().default([]),
  
  // Discord
  discordChannelId: varchar('discord_channel_id', { length: 20 }),
  discordThreadId: varchar('discord_thread_id', { length: 20 }),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  firstResponseAt: timestamp('first_response_at'),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  
  // Tags for filtering
  tags: jsonb('tags').$type<string[]>().default([]),
});

export const ticketMessages = pgTable('ticket_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => tickets.id).notNull(),
  authorId: uuid('author_id').references(() => players.id).notNull(),
  
  content: text('content').notNull(),
  isInternal: boolean('is_internal').default(false).notNull(),  // staff-only notes
  
  // If synced from Discord
  discordMessageId: varchar('discord_message_id', { length: 20 }),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  editedAt: timestamp('edited_at'),
});

export const ticketAuditLog = pgTable('ticket_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => tickets.id).notNull(),
  actorId: uuid('actor_id').references(() => players.id).notNull(),
  
  action: varchar('action', { length: 64 }).notNull(),
  // e.g. 'created', 'assigned', 'status_changed', 'priority_changed', 'commented', 'closed'
  
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Laws & Documents

```typescript
// packages/db/src/schema/laws.ts

// === DOCUMENT COLLECTIONS ===
// Top-level groupings: "Constitution", "Statutes", "Executive Orders", "Worldbuilding", etc.
export const documentCollections = pgTable('document_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(),     // 'legislation' | 'worldbuilding' | 'reference'
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  isPublic: boolean('is_public').default(true).notNull(),
});

// === BILLS ===
// Players write bills in Google Docs and submit the link via command.
// The Chancellor (or any player with legislative_leader permission) can also submit on behalf of others.
// The Chancellor puts bills to a legislature vote when they choose — no formal queue.
export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Identity
  title: varchar('title', { length: 256 }).notNull(),
  shortTitle: varchar('short_title', { length: 64 }),    // e.g. "ECON-003"
  slug: varchar('slug', { length: 256 }).notNull().unique(),
  billNumber: serial('bill_number'),                      // auto-incrementing: Bill #1, #2, etc.
  
  // === GOOGLE DOC SOURCE ===
  googleDocUrl: varchar('google_doc_url', { length: 512 }).notNull(),
  googleDocId: varchar('google_doc_id', { length: 128 }),  // extracted from URL for API access
  
  // === CACHED CONTENT ===
  // Snapshot of the Google Doc content for search/display/archival.
  // Google Doc remains the source of truth.
  cachedContent: text('cached_content'),
  cachedAt: timestamp('cached_at'),
  summary: text('summary'),                                // player or staff TL;DR
  
  // === AUTHORSHIP ===
  authorId: uuid('author_id').references(() => players.id).notNull(),
  // If submitted by Chancellor on someone's behalf, submittedById ≠ authorId
  submittedById: uuid('submitted_by_id').references(() => players.id).notNull(),
  coSponsorIds: jsonb('co_sponsor_ids').$type<string[]>().default([]),
  
  // === STATUS ===
  // submitted → voting → player_passed / player_rejected →
  //   → npc_pending → npc_passed / npc_rejected →
  //   → enacted → active → amended → repealed
  // (No queue/scheduled stages — Chancellor puts bills to vote at their discretion)
  status: varchar('status', { length: 32 }).default('submitted').notNull(),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  
  // Player house vote
  playerVoteId: uuid('player_vote_id').references(() => elections.id),
  playerVoteResult: varchar('player_vote_result', { length: 16 }),  // 'passed' | 'rejected'
  playerVoteAt: timestamp('player_vote_at'),
  
  // NPC house vote (entered manually by staff)
  npcVoteRequired: boolean('npc_vote_required').default(true).notNull(),
  npcVote: jsonb('npc_vote').$type<{
    status: 'pending' | 'passed' | 'rejected' | 'amended';
    tally?: {
      yea: number;
      nay: number;
      abstain: number;
      total: number;
    };
    amendmentNotes?: string;
    decidedAt?: string;
    enteredById?: string;
    notes?: string;
  }>(),
  
  // Final outcome
  enactedAt: timestamp('enacted_at'),
  effectiveAt: timestamp('effective_at'),
  repealedAt: timestamp('repealed_at'),
  repealedByBillId: uuid('repealed_by_bill_id').references((): any => bills.id),
  
  // === COLLECTION & HIERARCHY ===
  collectionId: uuid('collection_id').references(() => documentCollections.id),
  parentDocumentId: uuid('parent_document_id').references(() => documents.id),
  amendsBillId: uuid('amends_bill_id').references((): any => bills.id),
  
  // === CLASSIFICATION & SEARCH ===
  tags: jsonb('tags').$type<string[]>().default([]),
  policyAreas: jsonb('policy_areas').$type<string[]>().default([]),
  crossReferences: jsonb('cross_references').$type<string[]>().default([]),
  
  // === ECONOMY & POPSIM EFFECTS ===
  // TODO: link to economy/popsim modules when built
  estimatedEffects: jsonb('estimated_effects').$type<{
    economy?: {
      description: string;
      affectedSectors?: string[];
      estimatedGdpImpact?: string;
      rawModifiers?: Record<string, number>;
    };
    popsim?: {
      description: string;
      affectedGroups?: string[];
      estimatedApprovalImpact?: string;
      rawModifiers?: Record<string, number>;
    };
    notes?: string;
  }>(),
  
  // Full-text search (on cached content + title + summary)
  // searchVector: tsvector — handled by migration-level trigger
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// === BILL STATUS LOG ===
// Every status transition is logged with who did it and when.
export const billStatusLog = pgTable('bill_status_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id').references(() => bills.id).notNull(),
  
  fromStatus: varchar('from_status', { length: 32 }),
  toStatus: varchar('to_status', { length: 32 }).notNull(),
  
  changedById: uuid('changed_by_id').references(() => players.id).notNull(),
  notes: text('notes'),
  
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === STATIC DOCUMENTS (non-legislative) ===
// Worldbuilding docs, reference material, the constitution (as a living doc), etc.
// These aren't bills — they don't go through the legislative pipeline.
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').references(() => documentCollections.id).notNull(),
  
  title: varchar('title', { length: 256 }).notNull(),
  slug: varchar('slug', { length: 256 }).notNull().unique(),
  
  // Content can be inline or linked to a Google Doc (or both)
  content: text('content'),                                 // Markdown, for docs authored in the system
  googleDocUrl: varchar('google_doc_url', { length: 512 }), // optional Google Doc link
  cachedContent: text('cached_content'),                    // if linked to Google Doc, cached snapshot
  cachedAt: timestamp('cached_at'),
  
  // Hierarchy (for nested docs like constitution articles/sections)
  parentDocumentId: uuid('parent_document_id').references((): any => documents.id),
  hierarchyLevel: integer('hierarchy_level').default(0).notNull(),
  
  // Versioning
  currentVersion: integer('current_version').default(1).notNull(),
  
  // Metadata
  authorId: uuid('author_id').references(() => players.id),
  accessLevel: varchar('access_level', { length: 16 }).default('public').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id).notNull(),
  
  versionNumber: integer('version_number').notNull(),
  content: text('content').notNull(),
  changeDescription: varchar('change_description', { length: 512 }),
  editedById: uuid('edited_by_id').references(() => players.id).notNull(),
  
  // If changed by an enacted bill (amendment)
  amendmentBillId: uuid('amendment_bill_id').references(() => bills.id),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Full-text search indexes (created in migration SQL):
// CREATE INDEX idx_bills_search ON bills USING gin(to_tsvector('english', title || ' ' || coalesce(cached_content, '') || ' ' || coalesce(summary, '')));
// CREATE INDEX idx_documents_search ON documents USING gin(to_tsvector('english', title || ' ' || coalesce(content, '') || ' ' || coalesce(cached_content, '')));
```

### Voting

```typescript
// packages/db/src/schema/voting.ts

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Identity
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description'),
  type: varchar('type', { length: 32 }).notNull(),
  // 'legislative_vote'           — vote on a bill (Chancellor only)
  // 'position_election'          — elect someone to an office (Chancellor creates, candidates submit)
  // 'appointment_confirmation'   — confirm a PM appointment (yea/nay)
  // 'general_election'           — e.g. general elections for parliament seats
  // 'party_primary'              — internal party vote
  // 'referendum'                 — public vote on a question
  // 'confidence_vote'            — vote of confidence/no confidence
  // 'constitutional_amendment'   — supermajority required
  // 'custom'                     — catch-all for anything else
  
  // Voting method
  method: varchar('method', { length: 32 }).notNull(),
  // 'fptp' | 'ranked_choice' | 'stv' | 'approval' | 'proportional'
  // | 'yea_nay_abstain' | 'two_round_runoff' | 'exhaustive_ballot'
  
  // === WHO CAN CREATE ===
  // Any player can create: referendum, party_primary, confidence_vote, custom
  // Chancellor (legislative_leader) only: legislative_vote, position_election, appointment_confirmation
  // Staff: any type
  requiredPermission: varchar('required_permission', { length: 32 }),
  // null = any player, 'legislative_leader' = Chancellor, 'staff' = staff only
  
  // Configuration
  config: jsonb('config').$type<{
    // === MAJORITY & THRESHOLD ===
    quorumRequired?: number;
    quorumType?: 'absolute' | 'percentage';
    passThreshold?: number;              // 0.5 = simple majority, 0.667 = supermajority, 0.75 = three-quarters
    majorityType?: 'simple' | 'absolute' | 'supermajority' | 'qualified' | 'unanimous';
    // 'simple' = more yea than nay (of those who vote)
    // 'absolute' = more than half of ALL eligible voters (not just those who voted)
    // 'supermajority' = uses passThreshold (e.g. 2/3)
    // 'qualified' = custom threshold
    // 'unanimous' = 100%
    
    // === CANDIDATE ELECTIONS ===
    seatsAvailable?: number;
    maxChoices?: number;                 // for approval voting
    
    // === RUNOFF CONFIG ===
    runoffEnabled?: boolean;             // if no majority in first round, trigger runoff
    runoffMethod?: 'top_two' | 'exhaustive' | 'instant'; 
    // 'top_two' = top 2 candidates go to a new vote
    // 'exhaustive' = lowest eliminated, re-vote until majority (multiple rounds)
    // 'instant' = ranked choice (instant runoff, single ballot)
    runoffThreshold?: number;            // % needed to win outright in first round (default 0.5)
    
    // === PROPORTIONAL ===
    proportionalMethod?: 'dhondt' | 'sainte_lague' | 'hare';
    
    // === VISIBILITY ===
    sealedResults?: boolean;
    anonymousBallots?: boolean;
    
    // === ELIGIBILITY ===
    eligibleFactions?: string[];
    eligibleParties?: string[];
    eligibleOffices?: string[];
    requireRegistration?: boolean;
    
    // === NPC HOUSE CONFIRMATION (for position elections / appointments) ===
    requiresNpcConfirmation?: boolean;   // does the winner need NPC house approval?
  }>().notNull(),
  
  // === POSITION LINK ===
  // If this election is for a specific office (governor, minister, etc.)
  // Winner is automatically appointed to the office on certification.
  forOfficeId: uuid('for_office_id').references(() => offices.id),
  
  // === NPC CONFIRMATION (for position elections) ===
  npcConfirmation: jsonb('npc_confirmation').$type<{
    status: 'pending' | 'confirmed' | 'rejected';
    tally?: {
      yea: number;
      nay: number;
      abstain: number;
      total: number;
    };
    decidedAt?: string;
    enteredById?: string;
    notes?: string;
  }>(),
  
  // === RUNOFF TRACKING ===
  parentElectionId: uuid('parent_election_id').references((): any => elections.id),
  // If this is a runoff, points to the original election
  roundNumber: integer('round_number').default(1).notNull(),
  
  // Timing
  nominationsOpenAt: timestamp('nominations_open_at'),
  nominationsCloseAt: timestamp('nominations_close_at'),
  votingOpensAt: timestamp('voting_opens_at').notNull(),
  votingClosesAt: timestamp('voting_closes_at').notNull(),
  
  // Status
  status: varchar('status', { length: 32 }).default('draft').notNull(),
  // 'draft' | 'nominations_open' | 'nominations_closed' | 'voting_open' | 'voting_closed'
  // | 'tallied' | 'runoff_needed' | 'npc_pending' | 'certified' | 'cancelled'
  
  // Results (populated after tallying)
  results: jsonb('results').$type<{
    totalVotes: number;
    turnout: number;
    quorumMet?: boolean;
    passed?: boolean;                    // for yea/nay
    rounds?: {                           // for ranked choice / elimination
      round: number;
      tallies: Record<string, number>;
      eliminated?: string;
    }[];
    finalTallies: Record<string, number>;
    winners?: string[];                  // candidate IDs or 'yea'/'nay'
    seatAllocation?: Record<string, number>;
    runoffTriggered?: boolean;           // true if no candidate met threshold
    runoffElectionId?: string;           // the follow-up election
  }>(),
  
  // Relationships
  relatedBillId: uuid('related_bill_id').references(() => bills.id),
  createdById: uuid('created_by_id').references(() => players.id).notNull(),
  
  // Discord
  discordMessageId: varchar('discord_message_id', { length: 20 }),
  discordChannelId: varchar('discord_channel_id', { length: 20 }),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  electionId: uuid('election_id').references(() => elections.id).notNull(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  partyId: uuid('party_id').references(() => parties.id),
  
  statement: text('statement'),             // candidate statement / manifesto
  nominatedById: uuid('nominated_by_id').references(() => players.id),
  
  isWithdrawn: boolean('is_withdrawn').default(false).notNull(),
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
});

export const ballots = pgTable('ballots', {
  id: uuid('id').primaryKey().defaultRandom(),
  electionId: uuid('election_id').references(() => elections.id).notNull(),
  voterId: uuid('voter_id').references(() => players.id).notNull(),
  
  // The actual vote — structure depends on method
  vote: jsonb('vote').$type<
    | { type: 'fptp'; candidateId: string }
    | { type: 'ranked'; ranking: string[] }                    // ranked_choice / STV
    | { type: 'approval'; approved: string[] }
    | { type: 'yea_nay'; choice: 'yea' | 'nay' | 'abstain' }
    | { type: 'two_round'; candidateId: string }               // same as fptp per round
    | { type: 'exhaustive'; candidateId: string }              // same as fptp per round
  >().notNull(),
  
  castAt: timestamp('cast_at').defaultNow().notNull(),
  
  // Ensure one vote per person per election
  // unique index on (electionId, voterId)
});
```

### Moderation

```typescript
// packages/db/src/schema/moderation.ts

export const modActions = pgTable('mod_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  targetPlayerId: uuid('target_player_id').references(() => players.id).notNull(),
  moderatorId: uuid('moderator_id').references(() => players.id).notNull(),
  
  type: varchar('type', { length: 32 }).notNull(),
  // 'note' | 'verbal_warning' | 'formal_warning' | 'mute' | 'temporary_suspension' | 'permanent_ban'
  
  reason: text('reason').notNull(),
  internalNotes: text('internal_notes'),       // staff-only context
  
  // For timed actions
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  
  // If appealed
  appealStatus: varchar('appeal_status', { length: 16 }),
  // null | 'pending' | 'accepted' | 'denied'
  appealReason: text('appeal_reason'),
  appealReviewedById: uuid('appeal_reviewed_by_id').references(() => players.id),
  
  // Related ticket (if the mod action came from a ticket)
  ticketId: uuid('ticket_id').references(() => tickets.id),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const modNotes = pgTable('mod_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetPlayerId: uuid('target_player_id').references(() => players.id).notNull(),
  authorId: uuid('author_id').references(() => players.id).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### Favours

```typescript
// packages/db/src/schema/favours.ts

// === FAVOUR CATEGORIES ===
// Political groups of interest that players can accumulate favours with.
// Staff create these per season — e.g. "Military Establishment", "Merchant Guild",
// "Church", "Provincial Landowners", "Urban Workers", etc.
export const favourCategories = pgTable('favour_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 32 }),
  description: text('description'),
  emoji: varchar('emoji', { length: 8 }),         // for Discord embeds
  colour: varchar('colour', { length: 7 }),        // hex colour
  
  // What can favours with this group be spent on? (descriptive, not enforced by bot)
  spendableOn: jsonb('spendable_on').$type<string[]>(),
  // e.g. ['military appointments', 'trade deals', 'intelligence']
  
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === PLAYER FAVOUR BALANCES ===
// Current balance per player per category. Denormalised for fast reads.
export const favourBalances = pgTable('favour_balances', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  categoryId: uuid('category_id').references(() => favourCategories.id).notNull(),
  balance: integer('balance').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // unique index on (playerId, categoryId)
});

// === FAVOUR TRANSACTION LOG ===
// Every grant, spend, and removal is logged.
export const favourTransactions = pgTable('favour_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  categoryId: uuid('category_id').references(() => favourCategories.id).notNull(),
  
  amount: integer('amount').notNull(),              // positive = grant, negative = spend/remove
  balanceAfter: integer('balance_after').notNull(),  // running balance after this transaction
  
  type: varchar('type', { length: 32 }).notNull(),
  // 'grant'   — staff gives favours to player
  // 'spend'   — player spends favours (staff processes)
  // 'remove'  — staff removes favours (penalty, correction, etc.)
  // 'transfer' — player-to-player transfer (if allowed, future)
  // 'system'  — automatic grant/removal (e.g. from time advance events, future)
  
  reason: varchar('reason', { length: 512 }),        // why this transaction happened
  
  // Who initiated it
  grantedById: uuid('granted_by_id').references(() => players.id),  // staff member, or null for system
  
  // Context
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## API Routes

### Auth
```
GET    /api/auth/discord              → Redirect to Discord OAuth2
GET    /api/auth/discord/callback     → Handle OAuth2 callback, create session
GET    /api/auth/me                   → Current user info + roles
POST   /api/auth/logout               → Destroy session
```

### Tickets
```
GET    /api/tickets                    → List tickets (filterable: status, category, assignee, priority, tags)
GET    /api/tickets/:id                → Get ticket with messages + audit log
POST   /api/tickets                    → Create ticket (opens Discord thread)
PATCH  /api/tickets/:id                → Update ticket (status, priority, assignee, tags)
POST   /api/tickets/:id/messages       → Add message (internal or external)
POST   /api/tickets/:id/assign         → Assign to staff member
POST   /api/tickets/:id/close          → Close ticket with resolution
GET    /api/tickets/categories         → List ticket categories
POST   /api/tickets/categories         → Create/update category (admin only)
GET    /api/tickets/metrics            → Dashboard metrics (avg response time, open count, etc.)
```

### Bills (Legislative Pipeline)
```
GET    /api/bills                       → List bills (filterable: status, author, policyArea, tags)
GET    /api/bills/:slug                 → Get bill with cached content, vote records, NPC result, effects
GET    /api/bills/:slug/status-log      → Full status history for this bill
POST   /api/bills                       → Submit a new bill (Google Doc URL, title, summary, tags; optional authorId for on-behalf-of)
POST   /api/bills/:slug/cache           → Re-cache content from Google Doc (staff or author)
PATCH  /api/bills/:slug                 → Update bill metadata (tags, summary, policy areas)
PATCH  /api/bills/:slug/effects         → Update economy/popsim effects (staff only)
GET    /api/bills/:slug/voters          → Who voted on this bill (player house + NPC house results)
POST   /api/bills/:slug/create-vote     → Create a legislature vote on this bill (Chancellor only)
POST   /api/bills/:slug/npc-vote        → Enter NPC house vote result (staff only)
POST   /api/bills/:slug/enact           → Mark bill as enacted (staff, after both houses pass)
POST   /api/bills/:slug/repeal          → Mark bill as repealed (links to repealing bill)
GET    /api/bills/search                → Full-text search across bills
GET    /api/bills/browse                → Dashboard browse with filters/sorting
```

### Documents (Non-legislative: worldbuilding, reference, constitution)
```
GET    /api/documents                   → List documents (filterable: collection, author, tags)
GET    /api/documents/:slug             → Get document with content
GET    /api/documents/:slug/versions    → Get version history
GET    /api/documents/:slug/diff        → Diff between two versions (?from=1&to=3)
POST   /api/documents                   → Create document (staff)
PATCH  /api/documents/:slug             → Update document (creates new version)
GET    /api/documents/search            → Full-text search (?q=term&collection=worldbuilding)
GET    /api/documents/collections       → List document collections
POST   /api/documents/collections       → Create/update collection (admin only)
```

### Voting
```
# === GENERAL (any player can create referendum, party_primary, confidence, custom) ===
GET    /api/elections                   → List elections (filterable: status, type, method, forOffice)
GET    /api/elections/:id               → Get election details + candidates + NPC confirmation data
POST   /api/elections                   → Create election/vote (permission checked by type — see requiredPermission)
PATCH  /api/elections/:id               → Update election config (creator or staff)
POST   /api/elections/:id/open          → Open voting
POST   /api/elections/:id/close         → Close voting
POST   /api/elections/:id/tally         → Tally votes and generate results (auto-triggers runoff if needed)
GET    /api/elections/:id/results       → Get results (respects sealed status)
POST   /api/elections/:id/candidates    → Register as candidate / submit self for position
POST   /api/elections/:id/vote          → Cast ballot
GET    /api/elections/:id/eligibility   → Check if current user can vote
GET    /api/elections/:id/turnout       → Get turnout stats

# === POSITION ELECTIONS (Chancellor only) ===
POST   /api/elections/:id/npc-confirm   → Enter NPC house confirmation result (staff only)
# Winner auto-appointed to office on certification (+ NPC confirmation if required)
# Discord role auto-assigned

# === RUNOFFS ===
POST   /api/elections/:id/create-runoff → Create runoff from inconclusive result (auto or manual)
GET    /api/elections/:id/rounds        → Get all rounds of an election (parent + runoffs)
```

### Offices & Appointments
```
GET    /api/offices                     → List all offices with current holders
GET    /api/offices/:id                 → Get office details + full holder history
POST   /api/offices                     → Create office (staff only)
PATCH  /api/offices/:id                 → Update office config (staff only)

# === PM APPOINTMENT POWER (requires appoint_ministers permission) ===
POST   /api/offices/:id/appoint         → Appoint a player to office (syncs Discord role, logs event)
POST   /api/offices/:id/remove          → Remove current holder from office (syncs Discord role, logs event)
# If office.requiresConfirmation=true, appointment creates a confirmation vote first
```

### Players
```
GET    /api/players                     → List players (filterable: faction, party, active, staff, alive)
GET    /api/players/:id                 → Full dossier: profile + offices + bills + votes + favours + event log
POST   /api/players/create              → Create character (name, bio, portraitUrl, startingAge, factionId, partyId)
                                          Calculates and grants starting age favour bonus if applicable.
PATCH  /api/players/:id                 → Update bio, portrait. Name changes flagged for staff approval.
POST   /api/players/:id/party           → Change party (updates DB + Discord role, logs event)
GET    /api/players/:id/tickets         → Player's ticket history
GET    /api/players/:id/votes           → Player's voting record (if not anonymous)
GET    /api/players/:id/offices         → Office history
GET    /api/players/:id/bills           → Bills authored and co-sponsored
GET    /api/players/:id/favours         → Favour balances + transaction history
GET    /api/players/:id/events          → Full event log
GET    /api/players/:id/health          → Current health status + ailment history
```

### Simulation / Time (staff only)
```
GET    /api/simulation/clock            → Current sim date, tick, season info
POST   /api/simulation/advance          → Advance time by N ticks (triggers aging, ailments, deaths)
POST   /api/simulation/advance/preview  → Dry-run: shows what WOULD happen without committing
GET    /api/simulation/history          → Time advance log with summaries
PATCH  /api/simulation/clock            → Update clock config (tick unit, pause/unpause)
POST   /api/simulation/ailment          → Manually assign ailment to player (staff override)
POST   /api/simulation/death            → Manually kill a player character (staff override)
POST   /api/simulation/heal             → Remove ailment from player (staff override)
```

### Favours
```
GET    /api/favours/categories          → List all favour categories
POST   /api/favours/categories          → Create new favour category (staff only)
PATCH  /api/favours/categories/:id      → Update category (staff only)
DELETE /api/favours/categories/:id      → Deactivate category (staff only)

GET    /api/favours/balances/:playerId  → Get all favour balances for a player
GET    /api/favours/balances            → Get all players' balances (staff only, for overview)
GET    /api/favours/leaderboard/:categoryId → Top players by favour balance in a category

POST   /api/favours/grant               → Grant favours to a player (staff only: playerId, categoryId, amount, reason)
POST   /api/favours/spend               → Spend/deduct favours (staff only: playerId, categoryId, amount, reason)
POST   /api/favours/remove              → Remove favours as penalty/correction (staff only)

GET    /api/favours/history/:playerId   → Transaction history for a player (filterable by category)
GET    /api/favours/history             → All transactions (staff only, filterable)
```

### Moderation (staff only)
```
GET    /api/moderation/players/:id      → Get mod history for player
POST   /api/moderation/actions          → Create mod action (warn, mute, suspend, ban)
PATCH  /api/moderation/actions/:id      → Update mod action (expire early, appeal decision)
POST   /api/moderation/notes            → Add staff note to player
GET    /api/moderation/actions           → List all mod actions (filterable)
GET    /api/moderation/stats            → Mod activity stats
```

### Dashboard
```
GET    /api/dashboard/overview          → Aggregate stats (active tickets, upcoming votes, player count)
GET    /api/dashboard/activity          → Recent activity feed across all systems
```

---

## Discord Commands

### Tickets
```
/ticket create                     → Opens modal with category selection + form fields
/ticket view <number>              → Shows ticket embed with status, assignee, priority
/ticket list [status] [assignee]   → Paginated list of tickets with filters
/ticket assign <number> <user>     → Assign ticket to staff member (staff only)
/ticket close <number> [reason]    → Close ticket with optional resolution note
/ticket note <number> <message>    → Add internal staff note (staff only)
/ticket reply <number> <message>   → Add public reply
/ticket priority <number> <level>  → Change priority (staff only)
/ticket link <number> <other>      → Link two tickets together
```

### Bills
```
/bill submit <title> <google_doc_url>  → Submit a bill (opens modal for summary, tags, policy areas)
/bill submit-for <user> <title> <url>  → Chancellor submits a bill on behalf of another player
/bill view <bill_number>               → Display bill embed (title, author, status, link, summary)
/bill search <query>                   → Full-text search across all bills
/bill list [status] [author]           → Browse bills with filters
/vote create type:legislative_vote bill:<bill_number>               → Create a legislature vote on this bill (Chancellor only)
/bill status <bill_number>             → Show full status timeline for a bill
/bill npc-vote <bill_number> <yea> <nay> <abstain> [notes]  → Enter NPC house vote on a bill (staff only)
```

### Documents (worldbuilding, reference)
```
/doc search <query>                    → Full-text search across non-legislative documents
/doc view <slug>                       → Display document content in embed (paginated if long)
/doc list [collection]                 → Browse documents by collection
```

### Voting
```
# Any player can create these types:
/vote create                       → Create new vote (opens modal: type, method, majority, title, description)
                                     Type determines permissions — referendum/custom = any player,
                                     position_election/appointment_confirmation = Chancellor only,
                                     legislative_vote = use /vote create type:legislative_vote instead
/vote cast <election_id>           → Cast ballot (DMs user ballot form for secret votes)
/vote results <election_id>        → Show results (if polls closed or unsealed)
/vote schedule                     → Show upcoming elections/votes
/vote info <election_id>           → Election details, candidates, method, timing, majority required
/vote rounds <election_id>         → Show all rounds of a multi-round election

# === POSITION ELECTIONS ===
/vote elect <office> [method]           → Create a position election (Chancellor only, opens candidate submissions)
                                     method defaults to FPTP, can be ranked_choice, two_round_runoff, etc.
/vote candidate-submit <election_id>    → Submit yourself as candidate for a position (opens statement modal)
/vote candidate-list <election_id>      → List candidates
/vote npc-confirm <election_id> <yea> <nay> <abstain> [notes]  → Enter NPC house confirmation (staff only)
```

### Offices & Appointments
```
/office list                       → Show all offices and current holders
/office info <office>              → Details on an office (permissions, how filled, holder history)
/office history <office>           → Full holder history for an office
/office appoint <office> <user>           → PM appoints player to a ministerial office (requires appoint_ministers permission)
                                     If office.requiresConfirmation=true, creates a confirmation vote first
/office dismiss <office> [reason]         → PM removes current holder from office (requires appoint_ministers permission)
                                     Both commands sync Discord roles and log to playerEventLog
```

### Players
```
/character create                  → Multi-step character creation (name, bio, portrait, age, faction, party)
                                     Shows favour bonus preview if age qualifies.
                                     Assigns Discord roles on completion.
/character edit                    → Edit bio and portrait. Name changes require staff approval.
/character view [user]             → Full character dossier embed (portrait, bio, age, health, offices, favours)
/player whois <character_name>            → Reverse lookup by character name
/player roster [faction] [party]          → List players with filters
/party join <party>                → Join/switch party (updates DB + Discord role, logs event)
/party leave                       → Leave current party (become independent)
/party list                        → List all parties with member counts
/player history [user]                    → View player event log (party changes, offices, ailments, etc.)
```

### Simulation / Time (staff only)
```
/time status                       → Show current sim date, tick, season info
/time advance [ticks]              → Advance time by N ticks (default 1). Triggers:
                                     - All players age
                                     - Random ailment rolls for elderly players
                                     - Death rolls for critically ill / very old players
                                     - Deaths posted to graveyard channel with auto-generated obituary
                                     - Logs everything to time_advance_log + player_event_log
                                     - Posts summary to announcement channel
/time advance preview [ticks]      → Dry-run showing what would happen
/time set <date>                   → Override current sim date (admin only)
/time pause                        → Pause the simulation clock
/time unpause                      → Unpause the simulation clock
/character ailment-add <user> <condition> <severity>  → Manually give player an ailment
/character ailment-remove <user> <condition>          → Cure an ailment
/character kill <user> <cause>               → Kill a player character (posts obituary to graveyard channel)
```

### Favours
```
# Players
/favour balance                    → View your own favour balances across all categories
/favour history [category]         → View your own transaction history

# Staff
/favour grant <user> <category> <amount> [reason]   → Give favours to a player
/favour spend <user> <category> <amount> [reason]    → Deduct favours (player spending them)
/favour remove <user> <category> <amount> [reason]   → Remove favours (penalty/correction)
/favour check <user>               → View a player's favour balances (staff only)
/favour history <user> [category]  → View a player's transaction history (staff only)
/favour categories                 → List all favour categories with descriptions
/favour category-create <name> [description] [emoji]    → Create new favour category (staff only)
/favour category-edit <name>       → Edit category details (staff only)
```

### Moderation (staff only)
```
/mod warn <user> <reason>          → Issue formal warning
/mod note <user> <content>         → Add private mod note
/mod history <user>                → View mod history
/mod suspend <user> <duration> <reason>
/mod unsuspend <user>
```

---

## Key Implementation Notes

### Discord Thread-per-Ticket
When a ticket is created, the bot:
1. Creates a private thread in a configured staff channel
2. Pins the ticket summary embed
3. Adds the ticket creator + assigned staff
4. Syncs messages bidirectionally between the thread and the webapp

### Voting Tallying Algorithms
Implement as a strategy pattern so adding new methods is straightforward:

```typescript
interface TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult;
  validate(ballot: BallotVote, config: ElectionConfig): boolean;
  // For methods that support it, check if a runoff is needed
  needsRunoff?(result: TallyResult, config: ElectionConfig): boolean;
}

const strategies: Record<VotingMethod, TallyStrategy> = {
  fptp: new FPTPStrategy(),
  ranked_choice: new RankedChoiceStrategy(),         // instant runoff (single ballot)
  stv: new STVStrategy(),                             // single transferable vote (multi-seat)
  approval: new ApprovalStrategy(),
  proportional: new ProportionalStrategy(),           // d'Hondt, Sainte-Laguë, or Hare
  yea_nay_abstain: new YeaNayStrategy(),              // with configurable majority type
  two_round_runoff: new TwoRoundRunoffStrategy(),     // first round → top 2 → second round
  exhaustive_ballot: new ExhaustiveBallotStrategy(),   // lowest eliminated each round, re-vote
};
```

The `YeaNayStrategy` must handle all majority types:
- **Simple majority**: yea > nay (of those who voted)
- **Absolute majority**: yea > 50% of all eligible voters
- **Supermajority**: yea ≥ passThreshold (e.g. 2/3 or 3/4) of voters
- **Unanimous**: 100% yea

The `TwoRoundRunoffStrategy.needsRunoff()` checks if any candidate exceeded `runoffThreshold`.
If not, it returns true and the system creates a new election with `parentElectionId` linking back.

### Document Version Diffing (for static docs like the constitution)
Use `diff` library to generate line-by-line diffs between document versions.
Display in webapp with green/red highlighting (like GitHub).
In Discord, show a summarised diff (added X lines, removed Y lines, key changes).
Bills don't need diffing since they live in Google Docs — version history is in Docs.

### Auth Model
- Discord OAuth2 for both bot interactions and webapp login
- Roles derived from: Discord roles (mapped in config) + database staff flags + office permissions
- Middleware chain: `requireAuth` → `requireStaff` → `requireRole('admin')`
- Session stored server-side (Redis or pg sessions) with httpOnly cookie

### Real-time Updates (stretch goal)
- WebSocket connection from webapp for live ticket updates, vote tallies
- Bot sends webhook events to API when Discord interactions happen
- API broadcasts to connected webapp clients

### Aging, Ailments & Death System
On each `/time advance` tick, the system runs the following lifecycle pipeline:

1. **Age all living players** — increment `currentAge` based on tick unit.
2. **Ailment rolls** — players above a configurable age threshold (e.g. 55+) get random ailment checks:
   - Probability increases with age (e.g. `baseChance + (age - threshold) * scaleFactor`)
   - Ailment pool configurable per season (gout, heart disease, tuberculosis, stroke, etc.)
   - Existing ailments increase severity check probability
3. **Death rolls** — players with critical ailments or extreme age get death checks:
   - Critical ailment: flat % chance per tick
   - Very old (e.g. 80+): increasing chance each tick
   - Ailment interactions: multiple major ailments compound the risk
4. **On death**:
   - Player marked `isAlive = false`, `deathDate` + `causeOfDeath` set
   - All offices vacated (triggers succession logic if configured)
   - Discord role updated (e.g. given "Deceased" role, party/office roles removed)
   - **Obituary posted to graveyard channel** (see Graveyard section below)
   - Event logged to `playerEventLog`

Configuration should be stored in `simulationClock` or a separate config table so it's tweakable per season:
```typescript
interface AgingConfig {
  ailmentAgeThreshold: number;       // age when ailments start
  ailmentBaseChance: number;         // base % per tick above threshold
  ailmentAgeScaling: number;         // additional % per year above threshold
  deathAgeThreshold: number;         // age when natural death becomes possible
  deathBaseChance: number;           // base % per tick above threshold
  deathAgeScaling: number;
  criticalAilmentDeathChance: number; // % per tick with critical ailment
  ailmentPool: {
    name: string;
    severity: 'minor' | 'major' | 'critical';
    weight: number;                   // relative probability
    minAge?: number;                  // some ailments only affect the very old
    description?: string;
  }[];
  
  // === CHARACTER CREATION CONSTRAINTS ===
  minStartingAge: number;             // e.g. 18
  maxStartingAge: number;             // e.g. 70
  defaultStartingAge: number;         // e.g. 30
  
  // === STARTING AGE FAVOUR BONUS ===
  // Older characters get bonus favours at creation — risk/reward tradeoff.
  // Older = more favours but closer to ailments and death.
  startingAgeFavourBonus: {
    enabled: boolean;
    // Bonus tiers: each tier grants favours when starting age is at or above the threshold.
    // Favours are distributed across categories (staff can configure which).
    tiers: {
      minAge: number;                 // e.g. 40
      totalFavours: number;           // total favours granted across all categories
      distributionMethod: 'player_choice' | 'random' | 'even';
      // 'player_choice' = player picks which categories to allocate to
      // 'random' = randomly distributed
      // 'even' = split evenly across all categories
    }[];
    // Example tiers:
    //   { minAge: 35, totalFavours: 2, distributionMethod: 'player_choice' }
    //   { minAge: 45, totalFavours: 5, distributionMethod: 'player_choice' }
    //   { minAge: 55, totalFavours: 9, distributionMethod: 'player_choice' }
    //   { minAge: 65, totalFavours: 14, distributionMethod: 'player_choice' }
    // A 55-year-old gets 9 favours but is already past the ailment threshold —
    // they might get gout on tick 1. A 25-year-old gets nothing but has decades.
  };
}
```

### Character Creation Flow
When a player runs `/character create`, the bot opens a multi-step modal:

1. **Name & Bio** (first modal):
   - Character name (required, text input)
   - Biography / description (optional, paragraph textarea — backstory, personality, goals)

2. **Portrait** (follow-up message):
   - Bot prompts: "Reply with an image to use as your character portrait, or say 'skip'."
   - Player uploads an image to the Discord channel (or provides a URL)
   - Bot stores the URL in `characterPortraitUrl`
   - Displayed in the webapp dossier and Discord profile embeds

3. **Age & Faction** (second modal or select menus):
   - Starting age (number input, constrained by `minStartingAge` / `maxStartingAge`)
   - Faction selection (select menu, from active factions)
   - Party selection (optional, select menu filtered by chosen faction)

4. **Favour Bonus Preview** (if applicable):
   - If the player's chosen age qualifies for a favour bonus, the bot shows what they'd get:
     "Starting at age 55 grants you 9 bonus favours. Choose how to distribute them:"
   - If `distributionMethod: 'player_choice'`: bot shows the favour categories with number inputs
   - Player allocates their bonus favours across the categories

5. **Confirmation**:
   - Bot displays the full character summary (name, bio, age, faction, portrait, favour allocation)
   - Player confirms → character is created
   - `playerEventLog` records `event_type: 'registration'`
   - Favour bonus transactions logged to `favourTransactions` with `type: 'system'`
   - Discord roles assigned (faction, party)
   - Welcome message posted to announcement channel

**Editing:** players can update their bio and portrait anytime via `/character edit`.
Name changes require staff approval (to prevent confusion). Age cannot be changed after creation.

### Player Dossier (Webapp)
The player profile page is the "dossier" — a comprehensive record of everything about a character:

**Header section:**
- Character portrait (large, left-aligned — or initials circle if no portrait)
- Character name in `text-display` (Crimson Pro, serif)
- Party/faction tags, current office badges, health status dot
- Age + birth date, registration date
- Brief bio excerpt (expandable)

**Tabbed sections below:**
- **Overview**: full bio, basic stats, current status
- **Offices**: chronological timeline of every office held (appointed, elected, removed, why)
- **Legislation**: every bill authored or co-sponsored, with status and vote outcome
- **Voting record**: how they voted on every bill and election (unless anonymous ballot)
- **Favours**: bar chart of current balances by category, full transaction history
- **Event log**: the complete history — party changes, office changes, ailments, everything

**If deceased:** portrait gets a subtle greyscale filter, thin `--accent-graveyard` bar across the top
with "Deceased — [cause], age [X]" in italic Lora. All data remains accessible — the dossier
becomes the memorial.
```

### Party Change Flow
When a player runs `/party join <party>`:
1. Validate the party exists and is active
2. Record old party in `playerEventLog` with `event_type: 'party_change'`
3. Update `players.partyId` in the database
4. **Discord role sync**: remove old party Discord role, add new party Discord role
   - Party → Discord role mapping stored in config (each party has a `discordRoleId`)
5. Post notification in a configured channel ("X has left Y and joined Z")
6. If the player held a party-specific office, flag for staff review

### Bill Submission Flow
The legislative pipeline in Discord:
1. **Player writes bill** in Google Docs — the bot never touches the authoring.
2. **Player submits**: `/bill submit "Economic Reform Act" <google_doc_url>` — opens a modal for summary, tags, policy areas. The bot:
   - Creates a `bills` row with status `submitted`
   - Fetches and caches the Google Doc content (for search/display)
   - Assigns a bill number (#001, #002, etc.)
   - Posts a notification in the legislation channel
   - **Alternatively**: Chancellor can use `/bill submit-for @player "Title" <url>` to submit on someone else's behalf
     (sets `authorId` to that player, `submittedById` to the Chancellor)
3. **Chancellor puts to vote**: When the Chancellor decides it's time, they run `/vote create type:legislative_vote bill:<bill_number>` which:
   - Creates an `election` linked to this bill (yea/nay/abstain type)
   - Advances bill status to `voting`
   - Posts the vote in the voting channel
   - No formal queue — the Chancellor decides the legislative agenda organically
4. **Player vote resolves**: After tallying, the bill status becomes `player_passed` or `player_rejected`.
5. **NPC house** (if `npcVoteRequired`): Staff enter the NPC result via `/bill npc-vote` or the webapp.
6. **Enacted**: If both houses pass, staff run enact or it auto-advances.

### Position Election Flow (Governor Example)
1. **Chancellor creates election**: `/vote elect "Governor of Northshire" fptp` (or `ranked_choice`, `two_round_runoff`, etc.)
   - Creates an `election` with `type: 'position_election'` and `forOfficeId` linked to the Governor office
   - Status set to `nominations_open`
   - Posted in announcement channel
2. **Candidates submit themselves**: Players run `/vote candidate-submit <election_id>` — opens a modal for their candidate statement
3. **Chancellor closes nominations** and **opens voting**
4. **Players vote** using whatever method was chosen
5. **Tally**:
   - If FPTP: highest votes wins
   - If `two_round_runoff` and no candidate hits `runoffThreshold` (default 50%+1):
     - Status set to `runoff_needed`
     - Top 2 candidates enter a new `election` with `parentElectionId` pointing back
     - Second round vote runs
   - If `ranked_choice`: instant runoff tallying (eliminate lowest, redistribute, repeat)
6. **NPC confirmation** (if `config.requiresNpcConfirmation`):
   - Staff enter NPC house result via `/vote npc-confirm`
   - If confirmed: winner gets the office
   - If rejected: election may need to be re-run (staff decision)
7. **Office assignment**: Winner is added to `officeHolders`, Discord role assigned, event logged

### PM Appointment Flow
The Prime Minister (or whoever holds an office with `appoint_ministers` permission) can:
1. `/office appoint "Minister of War" @player` — immediate appointment if `office.requiresConfirmation` is false:
   - Creates `officeHolders` entry with `appointmentMethod: 'appointed'`
   - Removes previous holder if any (logged with `removalReason: 'replaced'`)
   - Assigns Discord role to new holder, removes from old
   - Logs to `playerEventLog` for both players
2. If `office.requiresConfirmation` is true:
   - Creates an `appointment_confirmation` election (yea/nay) — "Confirm @player as Minister of War?"
   - If confirmed: appointment proceeds as above
   - If rejected: appointment fails, PM must choose someone else
3. `/office dismiss "Minister of War" [reason]` — removes the current holder:
   - Sets `endDate` + `removalReason: 'removed_by_appointer'` on the officeHolder
   - Removes Discord role
   - Logs event

### Google Doc Content Caching
- On bill submission, the API fetches the Google Doc content and stores it in `cachedContent`
- Content can be re-cached anytime via the API endpoint
- The cached content is used for: full-text search, displaying in the webapp bill viewer, and archival
- The Google Doc URL is always displayed as the canonical source — cached content is a convenience
- **Implementation**: use Google Docs API (read-only, OAuth2 with a service account) or scrape the published-to-web URL
- If API access isn't available, the bot can prompt the author to paste content into a modal as fallback

### Permission System
Permissions are derived from offices, not from Discord roles directly (though Discord roles are synced):
- **`legislative_leader`** — can create legislative votes on bills, position elections. Typically the Chancellor.
- **`appoint_ministers`** — can appoint/dismiss holders of offices with `filledBy: 'appointed'`. Typically the PM.
- **`call_elections`** — can create general elections. Could overlap with legislative_leader.
- **Staff** — can do anything, checked via `isStaff` flag.
- **Any player** — can create referenda, party votes, confidence votes, custom votes.
Permission checks look up `officeHolders` → `offices.permissions` at runtime. Multiple offices can share permissions.

### NPC House
The NPC house serves two purposes:
1. **Bill approval**: bills that pass the player vote go to the NPC house (`npcVoteRequired`). Staff enter results.
2. **Position confirmation**: some position elections/appointments require NPC confirmation (`requiresNpcConfirmation`). Staff enter results.
In both cases, staff use a command or the webapp. The NPC can pass, reject, or (for bills) amend.
Future stretch goal: NPC behaviour influenced by popsim approval ratings.

### Graveyard Channel
When a player character dies (from `/character kill`, `/time advance` death roll, or any other cause), the bot posts a rich obituary embed to a configured graveyard channel. The obituary is auto-generated from the player's event log:

**Embed content:**
- Character name, birth date, death date, age at death, cause of death
- **Party history**: every party they were a member of, with dates (from `playerEventLog` party_change events)
- **Offices held**: every office with dates served and how they got/left it (elected, appointed, died in office)
- **Legislative record**: bills they authored or co-sponsored, and whether they passed
- **Notable votes**: key votes they cast (optional — might be too noisy, could be staff-curated)
- **Favours**: final favour balances at time of death (flavourful — "died with 3 favours from the Church and 7 from the Military Establishment")
- A brief human-readable narrative stitched from the data: "Lord Ashford served as Minister of War from Year 3 to Year 7, and was a founding member of the Reform Party. He authored the Land Reform Act of Year 5. He died of pneumonia at the age of 72."

The graveyard channel is read-only for players — just a memorial wall. Each death gets its own message/embed.

Config: `GRAVEYARD_CHANNEL_ID` in env vars.

### Favours System
Favours are a soft currency representing political capital with various interest groups.
Staff create categories per season (e.g. "The Church", "Military Establishment", "Merchant Guild").
Players accumulate and spend favours through roleplay — the bot just tracks the ledger.

**Key design principle**: the bot is a *ledger*, not an economy engine. Staff manually grant and deduct
favours based on what's happening in the sim. The bot doesn't enforce what favours can be spent on —
the `spendableOn` field on categories is descriptive, not enforced. Staff decide whether a spend is valid.

**Player-facing**: players can check their own balances anytime with `/favour balance`. They see category names,
balances, and transaction history. This is public to the player but not to other players by default.

**Staff-facing**: staff can grant, spend, and remove favours with a reason attached to every transaction.
Every transaction is logged so there's a full audit trail. The webapp shows a staff dashboard with
all players' favour balances and a transaction log.

**Future hooks**: favours could interact with the popsim/economy system when built — e.g. spending
favours with the Military Establishment could give modifiers to military actions, or high favour
with a group could influence NPC house voting on related legislation.

### Bill Dashboard (Web)
The bill browser should support:
- **Filtering**: by status, policy area tags, author, date range, search query
- **Sorting**: by date (newest/oldest), title (A-Z), bill number, status, policy area
- **Detail view** for each bill shows:
  - Title, summary, bill number, current status
  - Link to the Google Doc (opens in new tab) + cached content preview
  - Author + co-sponsors (linked to player profiles)
  - Full status timeline (submitted → voting → NPC → enacted)
  - Player house vote record (who voted yea/nay/abstain, with links to profiles)
  - NPC house vote record (tally + any staff notes)
  - Economy/popsim estimated effects panel (manually entered for now, TODO: auto-computed)
  - Cross-referenced related bills (amendments, repeals)

---

## TODO: Economy & PopSim Integration

These systems don't exist yet but the scaffold is designed to hook into them.
When they're built, the integration points are:

### Economy Engine
- **Input**: laws/policies with `estimatedEffects.economy.rawModifiers` → feed into economy model
- **Output**: economy state changes → store results back on the document or in a separate `economy_effects` table
- **Display**: law detail page shows computed economic impact instead of/alongside manual estimates
- **API**: `GET /api/economy/state` (current economy), `GET /api/economy/projections` (what-if for pending bills)
- **Time integration**: economy ticks when `/time advance` runs; effects compound

### PopSim Engine
- **Input**: laws/policies with `estimatedEffects.popsim.rawModifiers` → feed into popsim model
- **Output**: population group approval/sentiment changes → displayed on law detail page
- **Display**: approval ratings per demographic group, projected vs actual
- **API**: `GET /api/popsim/state`, `GET /api/popsim/groups`, `GET /api/popsim/approval`
- **Time integration**: popsim ticks alongside economy on `/time advance`
- **Voting influence**: popsim could influence NPC house voting behaviour (stretch goal)

### Shared integration pattern
Both engines should follow this pattern:
1. `packages/economy/` and `packages/popsim/` as separate workspace packages
2. Each exports a `tick(currentState, activeModifiers) → newState` pure function
3. The simulation service calls both engines on `/time advance`
4. Results stored in their respective tables, cross-referenced to the laws that caused them
5. Webapp dashboards pull from these tables

---

## Environment Variables

```env
# Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/dps_manager

# API
API_PORT=3001
API_URL=http://localhost:3001
SESSION_SECRET=

# Web
WEB_PORT=5173
VITE_API_URL=http://localhost:3001/api

# Discord channel config
TICKET_CHANNEL_ID=
ANNOUNCEMENT_CHANNEL_ID=
VOTING_CHANNEL_ID=
MOD_LOG_CHANNEL_ID=
GRAVEYARD_CHANNEL_ID=
LEGISLATION_CHANNEL_ID=

# Optional
REDIS_URL=redis://localhost:6379
```

---

## Bootstrap Commands

```bash
# Initialise
pnpm init
pnpm add -w typescript @types/node tsx

# Create workspace packages
mkdir -p packages/{db,shared,bot,api,web}

# Database package
cd packages/db
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Bot
cd packages/bot
pnpm add discord.js
pnpm add -D @types/node

# API
cd packages/api
pnpm add fastify @fastify/cors @fastify/cookie @fastify/session @fastify/rate-limit

# Web
cd packages/web
pnpm create vite . --template react-ts
pnpm add @tanstack/react-router @tanstack/react-query zustand
pnpm add -D tailwindcss postcss autoprefixer
```

---

## What to Build First (Suggested Order)

### Phase 1: Foundation
1. Monorepo setup with pnpm workspaces
2. Database package with schema + migrations (all tables including simulation)
3. Bot skeleton (connects, registers commands, responds to /ping)
4. API skeleton (Fastify app, health check, auth flow)

### Phase 2: Player Registry + Simulation Clock
5. Character creation flow (multi-step modal: name, bio, portrait, age, faction)
6. Starting age favour bonus calculation and granting
7. Simulation clock setup (season init, time display)
8. `/time advance` with aging pipeline (age, ailments, death)
9. Party join/leave with Discord role sync + event logging
10. Player dossier command with portrait, bio, age, health, offices, favour summary

### Phase 3: Tickets
10. Ticket creation (Discord modal → DB → thread)
11. Ticket management commands (assign, status, close)
12. Web app shell with auth + ticket list/detail views

### Phase 4: Bill Pipeline
13. Bill submission flow (Google Doc URL → cached content → database)
14. Google Doc content caching service
15. Chancellor creates legislature vote on bills
16. NPC house vote entry for bills
17. Discord bill commands
18. Web bill browser + detail page with effects panel

### Phase 4b: Static Documents
19. Document CRUD + versioning (for worldbuilding, constitution, reference)
20. Full-text search across docs
21. Discord doc commands
22. Web document browser

### Phase 5: Voting & Offices
23. General vote creation (any player: referenda, confidence, custom)
24. Position elections (Chancellor: `/vote elect`, candidate submissions, NPC confirmation)
25. Ballot casting (with secret ballot DM flow)
26. Tallying algorithms (FPTP, yea/nay, ranked choice, two-round runoff)
27. Runoff auto-creation when no majority
28. PM appointment/dismissal with Discord role sync
29. Office management webapp (holder history, appointment tracking)
30. Results display (Discord embeds + web visualisations)

### Phase 5b: Favours
31. Favour categories CRUD (staff)
32. Grant/spend/remove commands with transaction logging
33. Player balance view (`/favour balance`)
34. Webapp favours dashboard

### Phase 6: Graveyard + Moderation + Polish
35. Graveyard channel obituary generation on death
36. Mod actions + history
37. Dashboard metrics
38. Audit logging across all systems
39. Permission refinement + testing

### Phase 7: Economy & PopSim (future)
40. Economy engine package + integration
41. PopSim engine package + integration
42. Auto-computed law effects replacing manual entries
43. Economy/popsim dashboards on webapp
44. Favour interactions with economy/popsim systems
```
