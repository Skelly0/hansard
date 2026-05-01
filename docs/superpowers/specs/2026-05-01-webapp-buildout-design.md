# Webapp build-out & spruce-up — Design

**Status**: design draft, ready for implementation planning
**Date**: 2026-05-01
**Branch**: `webapp-spruceup` (worktree)

## Summary

Finish the four under-construction items in the Hansard webapp and apply a "Generous"-tier polish sweep across existing pages.

The four under-construction items:
1. **Dashboard** — page renders only `'—'` placeholders despite a fully-built backend at `/api/dashboard/overview` and `/api/dashboard/activity`.
2. **Moderation modals** — Warn / Mute / Suspend buttons open a `ModalStub` reading "This action form is under construction."
3. **Auth context** — no `AuthProvider`, `useAuth`, or route guard exists; `/login` is unreachable through normal navigation. Two pages have `// TODO: Replace with real auth context` markers.
4. **Login page** — 22 lines, functional but no aesthetic match to the warm-ledger design system.

Polish tier is **Generous**: hooks up data, redesigns Login (ceremonial parchment), adds trend deltas + grouped activity feed to Dashboard, builds proper mod modals, and applies a light global sweep (empty-state copy, hover transitions, consolidated `<PlayerAvatar>`, hairline rules, warm modal shadows). Explicitly **not** Lavish — no sparkline charts, no command palette, no page transitions, no new visualizations on Bills/Voting/Players.

## Architectural decisions

### Auth

- **State layer**: TanStack Query (already used everywhere). `useAuth()` wraps `GET /api/auth/me` plus a logout mutation against the existing `POST /api/auth/logout`. No second state library introduced.
- **`useAuth()` return shape**:
  ```ts
  {
    user: SessionUser | null,            // null when unauthenticated
    isStaff: boolean,                    // false when unauthenticated
    permissions: string[],               // [] when unauthenticated
    hasPermission: (name: string) => boolean,
    logout: () => Promise<void>,
    isLoading: boolean,                  // true on initial fetch
  }
  ```
  Gating call sites use `isStaff` / `hasPermission` directly. They never need to null-check `user` because the booleans default to `false`/`[]`.
- **Discord OAuth callback** (`packages/api/src/plugins/auth.ts`): on success, look up `players` by `discord_id`. If no row exists, **auto-create as active player** (user choice — frictionless onboarding). The auto-create only needs `discordId` and `discordUsername` from the OAuth profile — every other column on `players` has a default (`isActive: true`, `isAlive: true`, `healthStatus: 'healthy'`, `ailments: []`, `startingFavoursGranted: false`, `isStaff: false`, `registeredAt: now()`). The auto-create also writes a `playerEventLog` row with `eventType: 'registration'`. Read `isStaff` and `staffRole` directly off the player row — there is no `staff_roles` table.
- **Office-holder permissions**: at session-create time, look up the player's current office holdings (`office_holders` where `endDate IS NULL`, joined to `offices.permissions: jsonb<string[]>`), aggregate (union, deduped) into `session.user.permissions`. This unblocks `requireRole('legislative_leader')` on `/api/bills/:slug/votes` and `requireRole('appoint_ministers')` on Offices routes — currently unreachable from the webapp.
- **Permission staleness (known limitation)**: `session.user.permissions` is computed once at login and not refreshed. If a player gains/loses an office mid-session, permissions are stale until they log out and back in. Acceptable for a DPS where role changes are rare events. Documented; not solved here.
- **Session shape after migration**: `session.user.id` becomes `players.id` (UUID), not the Discord snowflake. **This fixes a silent bug** — 28 API sites already treat `session.user.id` as a `players.id` foreign key, so any write today would error at the DB layer (or the session.user.id was being implicitly coerced). The session carries `{ id: players.id, discordId, username, avatar, isStaff, staffRole, permissions }`.
- **OAuth error handling**: any callback hit with `?error=...` (any value — `access_denied`, `invalid_request`, `server_error`, etc.) redirects to `/login?error=<code>`. The login page surfaces a friendly inline notice; for `access_denied` it reads "Sign-in cancelled." and for any other code "Discord rejected the sign-in (`<code>`). Try again."
- **Session staleness**: extend `requireAuth` to refetch the player by `session.user.id` and attach it to `request.player` (required, not optional — handlers consume it instead of refetching). If the player no longer exists, `session.destroy()` and 401. Cheap; protects against deleted-player FK violations.
- **Callback redirect**: change from `/dashboard` (route doesn't exist) to `/`.
- **Dev-mode CORS / cookies**: the existing Vite dev proxy in `packages/web/vite.config.ts` should be confirmed to forward credentials so the session cookie survives the API call. If it doesn't, add `proxy: { '/api': { target, changeOrigin: true, cookieDomainRewrite: 'localhost' } }`. In production, API and web are same-origin via Docker compose — no CORS issue.

### Permission gating (frontend mirrors backend)

Three patterns via `useAuth()`:

1. **Route-level** — `<RouteGuard requireStaff>` wraps protected routes. Non-staff land on a friendly 403 page.
2. **Section-level** — `{isStaff && <StaffOnlyPanel />}` for whole sections inside otherwise-public pages.
3. **Button-level** — `{isStaff && <button>...</button>}` for individual actions.

For office-holder permissions: `hasPermission('appoint_ministers')` etc.

**Defense in depth**: the API rejects with 403 for unauthorized POST/PATCH/DELETE. Frontend gating exists for UX (don't show buttons that won't work). Backend remains the source of truth.

#### Gating map (controls that exist today)

| Page | Gated controls | Mechanism |
|---|---|---|
| **Sidebar** | "Moderation" entry hidden for non-staff | conditional render |
| **Moderation page** | entire page | `<RouteGuard requireStaff>` |
| **Documents** | rollback button | `isStaff` (currently always-visible) |
| **TicketDetail** | "Close Ticket" button visible only to creator OR staff (currently always-visible) | conditional render |
| **BillDetail** | enact, repeal, edit-effects, NPC-vote buttons | `isStaff` |
| **BillDetail** | edit (own bill), cache-content | `isStaff || bill.authorId === user.id` |
| **BillDetail** | create-vote | `hasPermission('legislative_leader')` |
| **ElectionDetail** | certify, NPC-confirm | `isStaff` |
| **CharacterDossier** | mod-history view, kill, heal, edit-character | `isStaff` |
| **Simulation** | tick-advance, ailment, death, heal forms (page itself stays read-only viewable) | `isStaff` per form |
| **Favours** | grant, spend, remove, global history (own balance stays public) | `isStaff` per form |

(Favours category management is *not* gated here — its hooks don't exist yet; see "Out of gating scope" below.)

**Out of gating scope** (because the controls don't exist in the UI today):
- Documents create / edit / new-collection — no UI built. Drop until that work is scheduled separately.
- Offices create / edit / appoint / remove — page is read-only despite hooks being wired. Same call.
- Tickets create — Discord-only flow currently.
- Players character-create — Discord-only flow currently.
- Favours category management — `useDeleteFavourCategory` / `useUpdateFavourCategory` hooks don't exist in `packages/web/src/api/hooks/useFavours.ts`. UI can't be fully wired without them; backend routes already gated.

**Backend gaps to flag (out of scope here)**:
- `ElectionDetail` open / close / tally backend routes (`voting.ts:139, 156, 173`) are currently `requireAuth` only — likely should be `requireStaff`. **Not changing in this work**; flagging for a future security review.
- `players.ts:254-322` has stub endpoints returning empty `{ tickets: [] }` etc. with `// TODO: Wire up X service`. `CharacterDossier` consumes these. Tabs will silently render empty states post-spruceup. Not fixing here.

### Component design

- **`<ModActionModal type="warn"|"mute"|"suspend">`** — single component, discriminated-union props. Mute and Suspend show a duration picker (chips for 1h/24h/7d/30d/Permanent + Custom datepicker); Warn shows a sub-type radio (verbal vs formal). All three share target-player typeahead, reason (required), internal notes (optional). Submits to existing `POST /api/moderation/actions` with optimistic insert.
- **`<PlayerAvatar player={...} size="sm"|"md" />`** — initial-circle avatar in deterministic system color (hash of `player.id` mod the palette length). Palette: `accent-bills`, `accent-voting`, `accent-players`, `accent-offices`, `accent-tickets`, `accent-simulation`, `accent-graveyard` (7 muted earth tones already in `tailwind.config.ts`). Initial = first character of `characterName ?? discordUsername`, uppercased. White text on color background. `size="sm"` = 18px, `size="md"` = 32px.
- **`<RouteGuard>`** — wraps a route component. Props: `{ requireStaff?: boolean, requirePermission?: string, children }`. Reads from `useAuth()`. Redirects to `/login` if unauthenticated, renders the `<Forbidden>` page if authed but lacking access.
- **`<UserMenu>`** — sidebar footer. Two render modes:
  - Expanded (`collapsed={false}`): `<PlayerAvatar size="sm">` + character/Discord name + small chevron, opens a popover with "Sign out" button.
  - Collapsed (`collapsed={true}`): just the avatar, click opens the same popover anchored to the avatar.

  Loading: render a skeleton circle. Unauthenticated: no UserMenu rendered (RouteGuard would have redirected anyway).

**Existing avatar implementations to consolidate** (replace with `<PlayerAvatar>`):
- `packages/web/src/pages/Players.tsx:21-41` — `InitialsCircle` definition
- `packages/web/src/pages/Players.tsx:223-234` — inline ad-hoc avatar render
- `packages/web/src/pages/CharacterDossier.tsx:50-70` — `InitialsCircle` duplicate
- `packages/web/src/pages/CharacterDossier.tsx:118-129` — inline ad-hoc avatar render
- `packages/web/src/pages/Offices.tsx:86-98` — inline ad-hoc avatar render

## Backend changes

```
packages/api/src/plugins/auth.ts
  - implement findOrCreatePlayerByDiscordId() in services/playerService.ts
  - in callback: lookup → create-if-missing → fetch officeHolders + offices.permissions
                 → populate session.user with { id: player.id, discordId, username, avatar,
                                                isStaff, staffRole, permissions }
  - on any ?error=<code> in callback: redirect to /login?error=<code>
  - fix callback redirect from /dashboard to /

packages/api/src/middleware/requireAuth.ts
  - after the session check, refetch player by session.user.id
  - if not found: session.destroy() and return 401
  - attach to request.player (required) — handlers must consume request.player rather than
    refetching, both for performance and to avoid stale reads inside a single request

packages/api/src/services/playerService.ts (or new file)
  - findOrCreatePlayerByDiscordId(db, { discordId, discordUsername }):
      INSERT players (discord_id, discord_username) VALUES (?, ?)
        ON CONFLICT (discord_id) DO UPDATE SET discord_username = EXCLUDED.discord_username
        RETURNING *;
      Then if it was a fresh insert, write a playerEventLog row eventType='registration'.
      Returns { player, wasCreated: boolean }.
  - aggregatePermissionsForPlayer(db, playerId): Promise<string[]>
      SELECT DISTINCT unnest(o.permissions) FROM office_holders oh
        JOIN offices o ON oh.office_id = o.id
        WHERE oh.player_id = ? AND oh.end_date IS NULL;

  - extend ListPlayersFilters to include { search?: string }
  - extend listPlayers() to apply the search via
      ILIKE on character_name OR discord_username when filters.search is set

packages/api/src/routes/players.ts
  - in GET /api/players Querystring extraction: if (q.search) filters.search = q.search;
    (the frontend hook already sends this query param — currently silently dropped)

packages/shared/src/players.ts (or wherever ListPlayersQuery lives)
  - add search?: string to ListPlayersQuery type

packages/api/src/routes/dashboard.ts
  - extend GET /api/dashboard/overview to include prevWeek counts.
  - Important: today the endpoint returns absolute counts via simple COUNT() queries.
    For trend deltas we need counts as of 7 days ago. For tickets/bills/players/mod actions
    that's a COUNT() with a created_at < (now - 7d) WHERE clause. For votes the proxy
    is elections created in last 7d vs prior 7d. For sim tick the trend is delta-since-prev-week
    (current_tick at session-time minus current_tick 7 days ago), which requires a tick-history
    table OR (simpler) just omit prevWeek for sim tick and show only current_date there.
  - Recommended return shape:
      { tickets, bills, votes, players, modActions, simTick, simDate,
        prevWeek: { tickets, bills, votes, players, modActions } | null }
    Clients compute trend strings client-side. Send `prevWeek: null` if any sub-query fails
    so the frontend can hide deltas gracefully.

packages/api/src/types.ts
  - update SessionUser to: { id: string (UUID), discordId: string, username: string,
                             avatar: string | null, isStaff: boolean,
                             staffRole: string | null, permissions: string[] }
  - augment FastifyRequest with optional `player?: Player` (populated by requireAuth)
```

No new tables, no migrations.

## Frontend changes

```
packages/web/src/
  api/hooks/useAuth.ts                ← NEW: useAuth (query + logout mutation)
  api/hooks/useDashboard.ts           ← NEW: useDashboardOverview, useDashboardActivity
                                              (consumes existing /api/dashboard/overview + /activity)
  api/hooks/usePlayers.ts             ← MODIFY: export a useSearchPlayers convenience that
                                              calls usePlayers({ search, limit: 8 }) — the
                                              underlying search param is already wired on
                                              the hook side; backend was silently dropping it
  api/hooks/useModeration.ts          ← MODIFY: add useCreateModAction mutation hook for
                                              POST /api/moderation/actions with optimistic
                                              insert into the moderation list cache
  components/auth/AuthProvider.tsx    ← NEW: wires QueryClient observer; redirects to /login
                                              on 401 from /api/auth/me; sets up logout
                                              cache-clear on success
  components/auth/RouteGuard.tsx      ← NEW: { requireStaff?, requirePermission?, children }
  components/auth/Forbidden.tsx       ← NEW: 403 page with warm copy
  components/layout/UserMenu.tsx      ← NEW: see Component design — handles collapsed mode
  components/layout/Sidebar.tsx       ← MODIFY: hide Moderation when !isStaff, render UserMenu
                                              in footer (replaces "DPS Season Manager" line)
  components/shared/PlayerAvatar.tsx  ← NEW: see Component design
  components/shared/ModActionModal.tsx ← NEW: replaces three ModalStub instances on Moderation
  pages/Login.tsx                     ← REWRITE: ceremonial parchment design
  pages/Dashboard.tsx                 ← REWRITE: hooked up, grouped activity feed, trend deltas
  pages/Moderation.tsx                ← MODIFY: replace ModalStub usage with ModActionModal
  pages/Favours.tsx                   ← MODIFY: useAuth() actor, gate grant/spend/remove
  pages/Simulation.tsx                ← MODIFY: useAuth() actor, gate forms
  pages/BillDetail.tsx                ← MODIFY: gate enact/repeal/edit-effects/NPC-vote/edit/cache/create-vote
  pages/ElectionDetail.tsx            ← MODIFY: gate certify/NPC-confirm (handle existing bar chart with care)
  pages/CharacterDossier.tsx          ← MODIFY: gate mod-history/kill/heal/edit (top-level only — 669 lines)
  pages/TicketDetail.tsx              ← MODIFY: gate Close button to creator-or-staff
  pages/Documents.tsx                 ← MODIFY: gate rollback button
  pages/Players.tsx                   ← MODIFY: replace inline InitialsCircle with PlayerAvatar
  router.tsx                          ← MODIFY: wrap protected routes in RouteGuard; ensure /login is unguarded
  main.tsx                            ← MODIFY: wrap router in AuthProvider
  main.css                            ← MODIFY: add .rule (hairline), shadow-modal-warm utility,
                                              parchment classes for Login
  tailwind.config.ts                  ← MODIFY: add boxShadow.modalWarm, plus any auth status colors needed
```

## Polish details (Generous tier)

### Login page (ceremonial parchment)

All colors use Tailwind tokens already defined in `tailwind.config.ts` (`bg-page`, `accent-primary-light`, `border-DEFAULT`, `border-subtle`, `text-primary`, `text-secondary`, `text-tertiary`).

- Cream-to-warm gradient background — `linear-gradient(180deg, var(--page) 0%, var(--accent-primary-light) 100%)` realized in `main.css` as `.bg-parchment`. Tokens map to `#FAF9F5` and `#F5E6DF` respectively.
- Double decorative border around the central card — outer `1px solid border-DEFAULT` (`#D4D1C7`), inner `1px solid border-subtle` (`#E8E6DC`), `~12px` gap.
- Preamble: `text-mono text-label text-text-tertiary tracking-[0.15em] uppercase` rendering `— PER ORDER OF THE CHAMBER —`
- Title "Hansard" in `font-display` italic, `~2.5rem` (custom; not in current `fontSize` map — define inline or extend tailwind)
- Dingbat ornament `✦` flanked by 20px hairline rules (`bg-border-strong`)
- Italic flavor quote: *"Be it known that the record of these proceedings is faithfully kept."* — `font-body italic text-text-secondary`
- Discord OAuth button — existing `.btn-primary` class (signature terracotta)
- Footer: `text-mono text-xs text-text-tertiary tracking-wider` rendering `DPS · SEASON MANAGER` (static — no live tick; that would need an unauthenticated public endpoint, out of scope)
- **Error notice**: when URL has `?error=<code>`, render a small `text-body-sm text-status-rejected italic` line above the button:
  - `?error=denied` → "Sign-in cancelled. Try again when you're ready."
  - any other code → "Discord rejected the sign-in (`<code>`). Try again."

### Dashboard

- Six metric cards. Each: small-caps monospace label, mono numeric value, system-colored 3px left border. Trend delta line below in `text-mono text-xs text-text-tertiary`.
- **Trend delta formatting** (computed client-side from `prevWeek` in the response):
  - `delta > 0` → `+N this week`
  - `delta < 0` → `−N this week` (real minus glyph U+2212, not hyphen)
  - `delta === 0` → `— no change`
  - `prevWeek === null` (backend couldn't compute) OR Sim Tick card → render the current sim date instead (`text-mono text-xs`)
- Activity feed: grouped by system (Legislature / Tickets / Moderation / Players). Each section header has a 2px colored left-border + small-caps `text-mono` label in the system color. Rows: `<PlayerAvatar size="sm">` actor + description prose (`text-body-sm`) + relative time on the right (`text-mono text-xs text-text-tertiary`). Use `Intl.RelativeTimeFormat` with `numeric: 'auto'` for the relative time — no external dep.
- Empty state: centered ✦ above "*All quiet on the chamber floor.*" — `text-body-sm italic text-text-secondary`.
- Skeleton: existing `PageSkeleton` covers loading.

### Moderation modals (`<ModActionModal>`)

- Decorative 3px top rule in the system color of the type (brick-red for warn/suspend, slate-blue for mute).
- Header: small-caps type label + title ("Issue Warning" / "Issue Mute" / "Issue Suspension").
- Fields:
  - **Target player** — typeahead via `useSearchPlayers(search)` against `/api/players?search=` (already exists). Renders as avatar + name + handle on selection.
  - **Type** — radio (verbal vs formal). *Warn modal only.*
  - **Duration** — chip group (1h / 24h / 7d / 30d / Permanent) with "Custom..." revealing a datetime picker. *Mute and Suspend only.* Submits as `expiresAt: ISO8601 | null`.
  - **Reason** — required textarea, min 8 chars, validation inline.
  - **Internal notes** — optional textarea, label decorated with italic "*staff only*".
- Footer: `Cancel` (ghost) + primary action button in system color.
- Submit: optimistic insert into the active-actions list with a "pending" tag; replaces with server response on settle. On error: keep modal open, show inline error banner above buttons.
- Close on Escape; click-outside-to-close.

### Light global polish sweep

- **Empty-state copy** — applied via the existing `<DataTable emptyMessage={...}>` prop (see `Bills.tsx:187`, `Players.tsx`, etc.) and any inline empty fallback divs. One bespoke line per list page:
  - Bills: "The legislature has yet to introduce a bill in this filter."
  - Tickets: "Inbox is empty. The chamber rests."
  - Voting: "No votes are scheduled."
  - Documents: "No documents in this collection."
  - Graveyard: "None have been laid to rest."
  - Favours: "No exchanges of favour on record."
  - Players, Offices, Moderation: existing copy is already good — leave.
- **Hover transitions** — confine to existing `.card` class and `DataTable` rows. Add `transition-colors duration-150 ease-out` if missing. Don't apply globally; do not switch to `transition-all` (avoids unintended shadow / transform animations elsewhere).
- **Hairline rule (`.rule` class)** — added to `main.css`:
  ```css
  .rule {
    border: 0;
    border-top: 1px solid var(--border-subtle, #E8E6DC);
    margin: 1.5rem 0;
  }
  ```
  Drop in via `<hr className="rule" />` where pure margin is currently used between section headings (Dashboard, BillDetail, CharacterDossier top-level only). Don't refactor existing layouts to chase this; only add where the divider clarifies hierarchy.
- **Warm modal shadow** — extend `tailwind.config.ts` `boxShadow`:
  ```ts
  modal: '0 4px 12px rgba(20, 20, 19, 0.08)',          // existing
  'modal-warm': '0 8px 32px rgba(120, 90, 60, 0.18)',  // new
  ```
  Apply `shadow-modal-warm` to `<ModActionModal>`. Leave the existing `shadow-modal` usage in other modals (Documents version compare, etc.) untouched.
- **PlayerAvatar consolidation** — see Component design for the 5 specific call sites.

### What we're explicitly NOT touching (Generous, not Lavish)

- No sparkline mini-charts (trend deltas are text only).
- No new charts or visualizations on Bills, Voting, Players (existing pages stay structurally identical except for gating + hover/empty-state polish).
- No command palette, page transitions, or keyboard shortcuts beyond Escape-to-close.
- No mobile-specific overhaul.
- ElectionDetail's hand-rolled candidate bar chart (lines 239-269) stays as-is — has special winner handling.
- CharacterDossier internals (it's 668 lines with 6 tabs and inline subcomponents); only top-level changes (header gating, avatar swap).
- Documents `VersionHistoryPanel` internals — interlocking state, easy to break.

## Execution order

1. **Auth foundation** — backend OAuth callback rewrite (player lookup + auto-create + permissions aggregation + redirect fix + denial handling) and `requireAuth` session-staleness check. Frontend `useAuth`, `AuthProvider`, `RouteGuard`, `Forbidden`. **Verify**: log in fresh; `/api/auth/me` returns the populated shape; staleness check works (delete a player while authed → next request 401s).
2. **Sidebar UserMenu + permission gating sweep** — render UserMenu in sidebar footer; hide Moderation entry; gate the buttons listed in the gating map across BillDetail, ElectionDetail, CharacterDossier, Simulation, Favours, Documents, TicketDetail. **Verify**: as a non-staff player, every gated control is invisible; as a staff player, all are visible.
3. **Login page** — ceremonial parchment redesign.
4. **Dashboard** — sub-step (a): extend `/api/dashboard/overview` with prevWeek counts (see Risks for SQL caveats). Sub-step (b): create `useDashboard.ts` with `useDashboardOverview` + `useDashboardActivity` hooks. Sub-step (c): rewrite `Dashboard.tsx` to consume them; build grouped activity feed component. **Verify**: dashboard renders real numbers, trend deltas display correctly for all four cases (positive/negative/zero/null), activity feed groups by system.
5. **`<ModActionModal>`** — sub-step (a): backend additions for `/api/players?search=` (extend `ListPlayersFilters`, `ListPlayersQuery`, route, `listPlayers` service). Sub-step (b): create `useSearchPlayers` and `useCreateModAction` hooks. Sub-step (c): build `<ModActionModal>` component with three modes; replace ModalStub usage on Moderation page; wire optimistic insert via TanStack Query mutation. **Verify**: typeahead works, all three modal modes submit successfully, optimistic insert + rollback on error.
6. **Polish sweep** — `<PlayerAvatar>` consolidation; bespoke empty-state copy on every list page; consistent hover transitions; `.rule` and warm modal shadow CSS.
7. **End-to-end verification** — manually test in browser as both staff and non-staff player; smoke test every page; ensure no leaked controls; ensure all redirects work.

## Risks

- **Step 1 is load-bearing**. If the OAuth callback breaks, the whole app is locked out. Commit independently and verify end-to-end before moving to step 2. Smoke test: log in fresh as a new Discord user (auto-create path), then a returning user (lookup path), then an account that's been deleted from the DB (staleness path).
- **Hooks must exist before consumers compile**. `useDashboardOverview` / `useDashboardActivity` (step 4), `useSearchPlayers` (step 5), `useCreateModAction` (step 5) must be added in their parent step's first sub-step before the consuming components are rewritten. TypeScript will catch this immediately, but it's an order-of-operations risk inside each step.
- **Dashboard `prevWeek` is not append-only backend work**. `/api/dashboard/overview` currently uses simple `COUNT()` queries. Adding prevWeek requires either (a) date-windowed counts on each entity (cheap — `WHERE created_at < (now - 7d)`) or (b) for sim tick, a tick-history table (out of scope — fall back to omitting prevWeek for that card). Implementer should plan ~30-60 lines of new SQL, not a 5-line add.
- **CharacterDossier is fragile** (668 lines, inline subcomponents, `inlineX ?? fetched ?? []` fallback pattern). Limit changes to the top-level header for gating + the avatar swap. Don't touch tab logic.
- **ElectionDetail candidate chart** (lines ~239-269) is hand-rolled with winner highlighting. Don't refactor; just gate around it.
- **Documents `VersionHistoryPanel`** has interlocking state across `compareFrom` / `compareTo` / `rollbackTarget` / `rollbackMutation`. Just gate the rollback button; leave the panel logic alone.
- **Tag component is shared everywhere** but no changes planned to `statusToTagColor`. Treat as "do not touch" rather than active risk.

## Out of scope / known gaps (documented, not fixed)

- Backend stub endpoints in `packages/api/src/routes/players.ts:254-322` (player tickets/bills/votes/etc) returning empty arrays. CharacterDossier tabs render as empty.
- `useDeleteFavourCategory` / `useUpdateFavourCategory` hooks missing from `packages/web/src/api/hooks/useFavours.ts`.
- ElectionDetail open/close/tally backend routes are currently `requireAuth` only — likely should be `requireStaff`. Not changing.
- Documents create / edit / new-collection UIs don't exist.
- Offices CRUD UIs don't exist.
- Mobile-specific layout has not been audited.
