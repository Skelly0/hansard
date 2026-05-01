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

- **State layer**: TanStack Query (already used everywhere). `useAuth()` is a hook wrapping a query against `GET /api/auth/me` plus a logout mutation. No second state-management library introduced.
- **Discord OAuth callback** (`packages/api/src/plugins/auth.ts`): on success, look up `players` by `discord_id`. If no row exists, **auto-create as active player** (user choice — frictionless onboarding). Read `isStaff` and `staffRole` directly off the player row. There is no `staff_roles` table; staff metadata lives on the player record.
- **Office-holder permissions**: at session-create time, look up the player's current office holdings (`office_holders` joined to `offices.permissions: jsonb<string[]>`), aggregate into `session.user.permissions`. This unblocks `requireRole('legislative_leader')` on `/api/bills/:slug/votes` and `requireRole('appoint_ministers')` on Offices routes, which are currently unreachable from the webapp.
- **Session shape after migration**: `session.user.id` becomes `players.id` (UUID), not the Discord snowflake. **This fixes a silent bug** — 28 API sites already treat `session.user.id` as a `players.id` foreign key, so any write today would error at the DB layer. The session also carries `discordId`, `username`, `avatar`, `isStaff`, `staffRole`, and the aggregated `permissions: string[]`.
- **OAuth denial**: if Discord redirects with `?error=access_denied` (no `code`), redirect to `/login?error=denied` instead of returning a JSON 400 to a redirect flow.
- **Session staleness**: extend `requireAuth` to refetch the player by `session.user.id`. If the player no longer exists, destroy the session and return 401. Cheap; protects against deleted-player FK violations.
- **Callback redirect**: change from `/dashboard` (doesn't exist) to `/`.

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
| **Favours** | grant, spend, remove, category-management, global history (own balance stays public) | `isStaff` per form |

**Out of gating scope** (because the controls don't exist in the UI today):
- Documents create / edit / new-collection — no UI built. Drop until that work is scheduled separately.
- Offices create / edit / appoint / remove — page is read-only despite hooks being wired. Same call.
- Tickets create — Discord-only flow currently.
- Players character-create — Discord-only flow currently.

**Backend gaps to flag (out of scope here)**:
- `useDeleteFavourCategory` / `useUpdateFavourCategory` hooks don't exist in `packages/web/src/api/hooks/useFavours.ts`. Category management UI can't be fully wired without them; affects only the "category-management" gate in the table above.
- `ElectionDetail` open / close / tally backend routes (`voting.ts:139, 156, 173`) are currently `requireAuth` only — likely should be `requireStaff`. **Not changing in this work**; flagging for a future security review.
- `players.ts:254-322` has stub endpoints returning empty `{ tickets: [] }` etc. with `// TODO: Wire up X service`. `CharacterDossier` consumes these. Tabs will silently render empty states post-spruceup. Not fixing here.

### Component design

- **`<ModActionModal type="warn"|"mute"|"suspend">`** — single component, discriminated-union props. Mute and Suspend show a duration picker (chips for 1h/24h/7d/30d/Permanent + Custom datepicker); Warn shows a sub-type radio (verbal vs formal). All three share target-player typeahead, reason (required), internal notes (optional). Submits to existing `POST /api/moderation/actions` with optimistic insert.
- **`<PlayerAvatar player={...} size="sm"|"md" />`** — initial-circle avatar in deterministic system color (hash of `player.id`). Replaces the duplicated `InitialsCircle` in `Players.tsx` and `CharacterDossier.tsx` plus 4 ad-hoc avatar implementations across `Offices.tsx`, ticket renders, and the bill author link. Used in mod-action lists, dashboard activity feed, ticket replies, and wherever player names appear with available context.
- **`<RouteGuard>`** — wraps a route component. Props: `{ requireStaff?: boolean, requirePermission?: string, children }`. Reads from `useAuth()`. Redirects to `/login` if unauthenticated, renders 403 page if authed but lacking access.

## Backend changes

```
packages/api/src/plugins/auth.ts
  - implement findOrCreatePlayerByDiscordId() in services/playerService.ts
  - in callback: lookup → create-if-missing → fetch officeHolders + offices.permissions
                 → populate session.user with { id: player.id, discordId, username, avatar,
                                                isStaff, staffRole, permissions }
  - on OAuth denial (?error=access_denied): redirect to /login?error=denied
  - fix callback redirect from /dashboard to /

packages/api/src/middleware/requireAuth.ts
  - after the auth check, refetch player by session.user.id
  - if not found: session.destroy() and return 401
  - cache player on request.player to avoid duplicate lookups in handlers (optional)

packages/api/src/services/playerService.ts (or new file)
  - findOrCreatePlayerByDiscordId(db, discordUser): Promise<Player>
  - aggregatePermissionsForPlayer(db, playerId): Promise<string[]>

packages/api/src/routes/dashboard.ts
  - extend GET /api/dashboard/overview to include prevWeek counts
    (return shape adds: prevTickets, prevBills, prevVotes, prevPlayers, prevModActions, prevSimTickDelta)
  - clients compute trend strings client-side

packages/api/src/types.ts
  - update SessionUser type to include discordId, staffRole, permissions
```

No new tables, no migrations.

## Frontend changes

```
packages/web/src/
  api/hooks/useAuth.ts                ← NEW: query + logout mutation
  components/auth/AuthProvider.tsx    ← NEW: wires QueryClient observer; redirects on 401
  components/auth/RouteGuard.tsx      ← NEW: { requireStaff?, requirePermission?, children }
  components/auth/Forbidden.tsx       ← NEW: 403 page (warm copy)
  components/layout/UserMenu.tsx      ← NEW: avatar + name + logout, sidebar footer
  components/layout/Sidebar.tsx       ← MODIFY: hide Moderation when !isStaff, render UserMenu
  components/shared/PlayerAvatar.tsx  ← NEW: replaces 4-5 ad-hoc avatar implementations
  components/shared/ModActionModal.tsx ← NEW: replaces three ModalStub instances
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
  main.css                            ← MODIFY: add .rule (hairline divider), modal shadow utility, parchment classes for Login
```

## Polish details (Generous tier)

### Login page (ceremonial parchment)

- Cream-to-warm gradient background (`linear-gradient(180deg, #FAF9F5 0%, #F5E6DF 100%)`)
- Double decorative border (outer `1px #D4D1C7`, inner `1px #E8E6DC`)
- Preamble in monospace small caps: `— PER ORDER OF THE CHAMBER —`
- Title "Hansard" in italic display serif, larger size
- Dingbat ornament (`✦`) flanked by hairline rules
- Italic flavor quote: *"Be it known that the record of these proceedings is faithfully kept."*
- Discord OAuth button (signature terracotta)
- Footer: monospace `DPS · SEASON MANAGER` (static — no live tick query, would require an unauthenticated public endpoint)
- On `?error=denied` query param, render a small inline notice above the button: "Sign-in cancelled. Try again when you're ready."

### Dashboard

- Six metric cards. Each: small-caps monospace label, mono numeric value, system-colored 3px left border. Trend delta line below (`+2 this week` / `— no change`). Sim Tick card additionally shows current sim date.
- Activity feed: grouped by system (Legislature / Tickets / Moderation / Players). Each section header has a 2px colored left-border + small-caps label. Rows: `<PlayerAvatar size="sm">` actor + description prose + relative time on the right (mono).
- Empty state: centered ✦ above "*All quiet on the chamber floor.*"
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

- **Empty-state copy** (one bespoke line per list page):
  - Bills: "The legislature has yet to introduce a bill in this filter."
  - Tickets: "Inbox is empty. The chamber rests."
  - Voting: "No votes are scheduled."
  - Documents: "No documents in this collection."
  - Graveyard: "None have been laid to rest."
  - Favours: "No exchanges of favour on record."
  - Players, Offices, Moderation: existing copy is already good — leave.
- **Hover transitions** — make the existing card/row `transition-colors` consistent (`150ms ease-out`).
- **Hairline rules** — `.rule` class for decorative section dividers replacing pure margin.
- **Modal shadow** — warm-tinted `0 8px 32px rgba(120, 90, 60, 0.18)` instead of pure-black.
- **PlayerAvatar consolidation** — replace the 5 ad-hoc avatar implementations with the new component.

### What we're explicitly NOT touching (Generous, not Lavish)

- No sparkline mini-charts (trend deltas are text only).
- No new charts or visualizations on Bills, Voting, Players (existing pages stay structurally identical except for gating + hover/empty-state polish).
- No command palette, page transitions, or keyboard shortcuts beyond Escape-to-close.
- No mobile-specific overhaul.
- ElectionDetail's hand-rolled candidate bar chart (lines 239-269) stays as-is — has special winner handling.
- CharacterDossier internals (it's 669 lines with 6 tabs and inline subcomponents); only top-level changes (header gating, avatar swap).
- Documents `VersionHistoryPanel` internals — interlocking state, easy to break.

## Execution order

1. **Auth foundation** — backend OAuth callback rewrite (player lookup + auto-create + permissions aggregation + redirect fix + denial handling) and `requireAuth` session-staleness check. Frontend `useAuth`, `AuthProvider`, `RouteGuard`, `Forbidden`. **Verify**: log in fresh; `/api/auth/me` returns the populated shape; staleness check works (delete a player while authed → next request 401s).
2. **Sidebar UserMenu + permission gating sweep** — render UserMenu in sidebar footer; hide Moderation entry; gate the buttons listed in the gating map across BillDetail, ElectionDetail, CharacterDossier, Simulation, Favours, Documents, TicketDetail. **Verify**: as a non-staff player, every gated control is invisible; as a staff player, all are visible.
3. **Login page** — ceremonial parchment redesign.
4. **Dashboard** — extend `/api/dashboard/overview` with prevWeek counts; rewrite `Dashboard.tsx` to consume `useDashboardOverview` + `useDashboardActivity`; build grouped activity feed component.
5. **`<ModActionModal>`** — single component, three modes; replace ModalStub usage on Moderation page; wire optimistic insert via TanStack Query mutation.
6. **Polish sweep** — `<PlayerAvatar>` consolidation; bespoke empty-state copy on every list page; consistent hover transitions; `.rule` and warm modal shadow CSS.
7. **End-to-end verification** — manually test in browser as both staff and non-staff player; smoke test every page; ensure no leaked controls; ensure all redirects work.

## Risks

- **Step 1 is load-bearing**. If the OAuth callback breaks, the whole app is locked out. Commit independently and verify end-to-end before moving to step 2.
- **Tag component is shared everywhere**. Status-color changes ripple to Bills, Voting, BillDetail, ElectionDetail, TicketDetail, Players, CharacterDossier, Documents. No changes planned to `statusToTagColor`, but be careful.
- **CharacterDossier is fragile** (669 lines, inline subcomponents, `inlineX ?? fetched ?? []` fallback pattern). Limit changes to the top-level header for gating + the avatar swap.
- **ElectionDetail candidate chart** is hand-rolled with winner highlighting. Don't refactor; just gate around it.
- **Documents `VersionHistoryPanel`** has interlocking state across `compareFrom` / `compareTo` / `rollbackTarget` / `rollbackMutation`. Just gate the rollback button; leave the panel logic alone.
- **Sidebar collapsed mode** — UserMenu must render correctly when `collapsed={true}` (only avatar visible).

## Out of scope / known gaps (documented, not fixed)

- Backend stub endpoints in `packages/api/src/routes/players.ts:254-322` (player tickets/bills/votes/etc) returning empty arrays. CharacterDossier tabs render as empty.
- `useDeleteFavourCategory` / `useUpdateFavourCategory` hooks missing from `packages/web/src/api/hooks/useFavours.ts`.
- ElectionDetail open/close/tally backend routes are currently `requireAuth` only — likely should be `requireStaff`. Not changing.
- Documents create / edit / new-collection UIs don't exist.
- Offices CRUD UIs don't exist.
- Mobile-specific layout has not been audited.
