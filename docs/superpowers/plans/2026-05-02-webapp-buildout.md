# Webapp Build-out & Spruce-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the four under-construction items in the Hansard webapp (Dashboard, Moderation modals, Auth context, Login page) and apply a Generous-tier polish sweep across existing pages.

**Architecture:** Frontend auth via TanStack Query wrapping `GET /api/auth/me`. Backend Discord OAuth callback resolves player by `discord_id`, auto-creates if missing, aggregates office permissions. Frontend gates UI controls via `useAuth()` patterns (route-level, section-level, button-level). New `<ModActionModal>` (one component, three modes) replaces existing stubs. Dashboard hooks up existing `/api/dashboard/overview` + `/activity` endpoints with trend deltas and grouped activity feed. `<PlayerAvatar>` consolidates 5 ad-hoc avatar implementations. Polish sweep: empty-state copy, hover transitions, hairline rules, warm modal shadow.

**Tech Stack:** TypeScript, React 18, Vite 6, TanStack Router + Query, Tailwind CSS, Fastify v5, Drizzle ORM, PostgreSQL 16. Adding: vitest + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-05-01-webapp-buildout-design.md`

---

## File Structure

### Backend (`packages/api/src/`)

| File | Status | Responsibility |
|---|---|---|
| `types.ts` | MODIFY | Update `SessionUser`; augment `FastifyRequest` with `player` |
| `services/playerService.ts` | MODIFY | Add `findOrCreatePlayerByDiscordId`, `aggregatePermissionsForPlayer`; extend `ListPlayersFilters` with `search` |
| `plugins/auth.ts` | MODIFY | Rewrite OAuth callback (lookup/create, permissions, error generalization, redirect fix) |
| `middleware/requireAuth.ts` | MODIFY | Add player-staleness check; populate `request.player` |
| `routes/players.ts` | MODIFY | Pass `search` from query to service |
| `routes/dashboard.ts` | MODIFY | Add `prevWeek` to overview endpoint |

### Frontend (`packages/web/src/`)

| File | Status | Responsibility |
|---|---|---|
| `api/hooks/useAuth.ts` | CREATE | `useAuth` query (retry: false) + logout mutation |
| `api/hooks/useDashboard.ts` | CREATE | `useDashboardOverview`, `useDashboardActivity` |
| `api/hooks/usePlayers.ts` | MODIFY | Export `useSearchPlayers` convenience |
| `api/hooks/useModeration.ts` | MODIFY | Add optimistic insert to `useCreateModAction` |
| `components/auth/AuthProvider.tsx` | CREATE | Wires auth into the app; redirect on logout |
| `components/auth/RouteGuard.tsx` | CREATE | Route-level gating with skeleton while loading |
| `components/auth/Forbidden.tsx` | CREATE | 403 page (warm copy) |
| `components/layout/UserMenu.tsx` | CREATE | Sidebar footer (collapsed-aware) |
| `components/layout/Sidebar.tsx` | MODIFY | Hide Mod when !isStaff; render UserMenu |
| `components/shared/PlayerAvatar.tsx` | CREATE | Initial avatar with hash-based color |
| `components/shared/ModActionModal.tsx` | CREATE | Three-mode modal |
| `components/dashboard/trendFormat.ts` | CREATE | Pure trend-delta formatter |
| `components/dashboard/MetricCard.tsx` | CREATE | Metric card with trend delta |
| `components/dashboard/ActivityFeed.tsx` | CREATE | Grouped activity feed |
| `pages/Login.tsx` | REWRITE | Ceremonial parchment design |
| `pages/Dashboard.tsx` | REWRITE | Hooked up |
| `pages/Moderation.tsx` | MODIFY | Replace ModalStub with ModActionModal |
| `pages/{Favours,Simulation,BillDetail,ElectionDetail,CharacterDossier,TicketDetail,Documents}.tsx` | MODIFY | Permission gating |
| `pages/Players.tsx` | MODIFY | Replace InitialsCircle with PlayerAvatar |
| `pages/{Bills,Tickets,Voting,Documents,Graveyard,Favours}.tsx` | MODIFY | Empty-state copy |
| `router.tsx` | MODIFY | Wrap protected routes in RouteGuard |
| `main.tsx` | MODIFY | Wrap router in AuthProvider |
| `main.css` | MODIFY | `.rule`, `.bg-parchment` |
| `tailwind.config.ts` | MODIFY | `boxShadow.modal-warm` |

### Test infrastructure

| File | Status | Responsibility |
|---|---|---|
| `packages/web/vitest.config.ts` | CREATE | Vitest config with jsdom |
| `packages/web/src/test-setup.ts` | CREATE | Testing-library setup |
| `packages/web/package.json` | MODIFY | Add devDeps + `test` script |
| `packages/api/vitest.config.ts` | CREATE | Vitest config |
| `packages/api/package.json` | MODIFY | Add devDep + `test` script |

---

# Phase 0: Test Infrastructure

## Task 0.1: Set up Vitest in `packages/web`

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/test-setup.ts`

- [ ] **Step 1: Add devDependencies**

In repo root, run:

```bash
pnpm --filter @hansard/web add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event happy-dom
```

- [ ] **Step 2: Add `test` script to `packages/web/package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 3: Create `packages/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `packages/web/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Verify the setup works with a sanity test**

Create `packages/web/src/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm --filter @hansard/web test:run`
Expected: 1 passing test.

- [ ] **Step 6: Delete the sanity test and commit**

```bash
rm packages/web/src/sanity.test.ts
git add packages/web/package.json packages/web/vitest.config.ts packages/web/src/test-setup.ts
git commit -m "chore(web): add vitest + testing-library setup"
```

---

## Task 0.2: Set up Vitest in `packages/api`

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/vitest.config.ts`

- [ ] **Step 1: Add devDependency**

```bash
pnpm --filter @hansard/api add -D vitest
```

- [ ] **Step 2: Add `test` script to `packages/api/package.json`**

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 3: Create `packages/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Verify with sanity test**

Create `packages/api/src/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('api vitest', () => { it('runs', () => expect(true).toBe(true)); });
```

Run: `pnpm --filter @hansard/api test:run`
Expected: 1 passing test.

- [ ] **Step 5: Delete the sanity test and commit**

```bash
rm packages/api/src/sanity.test.ts
git add packages/api/package.json packages/api/vitest.config.ts
git commit -m "chore(api): add vitest setup"
```

---

# Phase 1: Backend auth foundation

## Task 1.1: Update `SessionUser` type and augment `FastifyRequest`

**Files:**
- Modify: `packages/api/src/types.ts`

- [ ] **Step 1: Read the existing types**

Run: `cat packages/api/src/types.ts`

You should see an existing module augmentation that looks like:

```ts
declare module '@fastify/session' {
  interface FastifySessionObject {
    user?: SessionUser;
  }
}
```

**You will REPLACE this augmentation, not add a parallel one.** Same module, same interface — only `SessionUser` changes shape.

- [ ] **Step 2: Rewrite `packages/api/src/types.ts`**

Replace the file contents with:

```ts
import '@fastify/session';
import type { Player } from '@hansard/db';

export interface SessionUser {
  id: string;            // players.id (UUID), NOT Discord snowflake
  discordId: string;
  username: string;
  avatar: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    user?: SessionUser;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
  }
}
```

If `@hansard/db` doesn't already export `Player`, also add to `packages/db/src/index.ts`:

```ts
import type { players } from './schema/players';
export type Player = typeof players.$inferSelect;
```

- [ ] **Step 3: Verify compile**

Run: `pnpm --filter @hansard/api build`
Expected: TypeScript errors in any files referencing the old `SessionUser` shape (especially `plugins/auth.ts`). Those will be fixed in Task 1.7. Do NOT fix them yet — leave the build broken.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/types.ts packages/db/src/index.ts
git commit -m "feat(api): expand SessionUser; augment FastifyRequest with player"
```

---

## Task 1.2: Implement `findOrCreatePlayerByDiscordId`

**Files:**
- Modify: `packages/api/src/services/playerService.ts`
- Create: `packages/api/src/services/playerService.test.ts` (sets a precedent for backend service tests)

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/services/playerService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { findOrCreatePlayerByDiscordId } from './playerService';

// Mock drizzle db: handles
//   - .select().from().where().limit() (returns existing or empty)
//   - .insert(players).values().onConflictDoUpdate().returning() (returns inserted)
//   - .insert(playerEventLog).values() (returns undefined, can throw)
// `insert` is called twice in the create path; the mock dispatches by the table arg.
function makeMockDb(existingPlayer: any | null, insertedPlayer: any) {
  const limit = vi.fn().mockResolvedValue(existingPlayer ? [existingPlayer] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const playersInsertChain = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([insertedPlayer]),
      }),
    }),
  };
  const eventLogInsertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };

  // First insert call (players) returns the players chain;
  // second insert call (playerEventLog) returns the eventLog chain.
  // We dispatch by call index — simpler than introspecting the table arg.
  const insert = vi.fn()
    .mockReturnValueOnce(playersInsertChain)
    .mockReturnValueOnce(eventLogInsertChain);

  return { select, insert };
}

describe('findOrCreatePlayerByDiscordId', () => {
  it('returns existing player without creating when found', async () => {
    const existing = { id: 'uuid-1', discordId: '123', discordUsername: 'alice', isStaff: false };
    const db: any = makeMockDb(existing, null);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '123', discordUsername: 'alice' });
    expect(result.player).toEqual(existing);
    expect(result.wasCreated).toBe(false);
  });

  it('creates a new player when none exists', async () => {
    const inserted = { id: 'uuid-new', discordId: '999', discordUsername: 'bob', isStaff: false, isActive: true };
    const db: any = makeMockDb(null, inserted);
    const result = await findOrCreatePlayerByDiscordId(db, { discordId: '999', discordUsername: 'bob' });
    expect(result.player).toEqual(inserted);
    expect(result.wasCreated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/api test:run playerService`
Expected: FAIL with `findOrCreatePlayerByDiscordId is not a function` (or import error).

- [ ] **Step 3: Implement the function**

Append to `packages/api/src/services/playerService.ts`:

```ts
import { players, playerEventLog } from '@hansard/db';

export interface FindOrCreateResult {
  player: typeof players.$inferSelect;
  wasCreated: boolean;
}

/**
 * Look up a player by Discord ID. If absent, insert a new active player row.
 * Uses ON CONFLICT to be safe under concurrent OAuth callbacks (two tabs).
 *
 * On fresh insert, also writes a playerEventLog row (eventType='registration').
 */
export async function findOrCreatePlayerByDiscordId(
  db: Database,
  input: { discordId: string; discordUsername: string },
): Promise<FindOrCreateResult> {
  // Try existing first
  const existing = await db.select().from(players).where(eq(players.discordId, input.discordId)).limit(1);
  if (existing.length > 0) {
    return { player: existing[0], wasCreated: false };
  }

  // Insert with ON CONFLICT for the race-where-two-tabs-fire-at-once case
  const inserted = await db
    .insert(players)
    .values({
      discordId: input.discordId,
      discordUsername: input.discordUsername,
      // every other column has a schema default
    })
    .onConflictDoUpdate({
      target: players.discordId,
      set: { discordUsername: input.discordUsername },
    })
    .returning();

  const player = inserted[0];

  // Best-effort registration log; don't fail the auth flow on logging failure
  try {
    await db.insert(playerEventLog).values({
      playerId: player.id,
      eventType: 'registration',
      description: `Player auto-registered via Discord OAuth (@${input.discordUsername})`,
    });
  } catch (err) {
    // Swallow — we already have the player; logging is nice-to-have
  }

  return { player, wasCreated: true };
}
```

You will also need to import `eq` from `drizzle-orm` if not already imported. Check the top of `playerService.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hansard/api test:run playerService`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/playerService.ts packages/api/src/services/playerService.test.ts
git commit -m "feat(api): findOrCreatePlayerByDiscordId service"
```

---

## Task 1.3: Implement `aggregatePermissionsForPlayer`

**Files:**
- Modify: `packages/api/src/services/playerService.ts`
- Modify: `packages/api/src/services/playerService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
import { aggregatePermissionsForPlayer } from './playerService';

describe('aggregatePermissionsForPlayer', () => {
  it('returns empty array when player holds no offices', async () => {
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    const result = await aggregatePermissionsForPlayer(db, 'player-uuid');
    expect(result).toEqual([]);
  });

  it('aggregates and dedupes permissions across multiple offices', async () => {
    const rows = [
      { permissions: ['legislative_leader', 'call_elections'] },
      { permissions: ['legislative_leader', 'appoint_ministers'] },
      { permissions: null }, // some offices have null permissions
    ];
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    };
    const result = await aggregatePermissionsForPlayer(db, 'player-uuid');
    expect(result.sort()).toEqual(['appoint_ministers', 'call_elections', 'legislative_leader']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/api test:run playerService`
Expected: 2 new failing tests (function not exported).

- [ ] **Step 3: Implement the function**

Append to `playerService.ts`:

```ts
import { officeHolders, offices } from '@hansard/db';
import { isNull } from 'drizzle-orm';

/**
 * Aggregate permissions for a player from all currently-active office holdings.
 * Currently-active = office_holders.endDate IS NULL.
 * Returns a deduped list of permission strings.
 */
export async function aggregatePermissionsForPlayer(db: Database, playerId: string): Promise<string[]> {
  const rows = await db
    .select({ permissions: offices.permissions })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(eq(officeHolders.playerId, playerId), isNull(officeHolders.endDate)));

  const set = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.permissions)) {
      for (const p of row.permissions) set.add(p);
    }
  }
  return Array.from(set);
}
```

Add `and` to the `drizzle-orm` import at the top of the file if not present.

- [ ] **Step 4: Run test to verify**

Run: `pnpm --filter @hansard/api test:run playerService`
Expected: 4 passing tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/playerService.ts packages/api/src/services/playerService.test.ts
git commit -m "feat(api): aggregatePermissionsForPlayer service"
```

---

## Task 1.4: Add `search` to `ListPlayersFilters` + service

**Files:**
- Modify: `packages/api/src/services/playerService.ts`

- [ ] **Step 1: Write the failing test**

Append to `playerService.test.ts`:

```ts
import { listPlayers } from './playerService';

describe('listPlayers with search', () => {
  it('passes search to the where clause', async () => {
    // Real chain in playerService.ts: from → where → orderBy → limit → offset
    const offset = vi.fn().mockResolvedValue([{ id: 'p1', characterName: 'Aldrick Vance' }]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db: any = { select };

    const results = await listPlayers(db, { search: 'aldrick', limit: 10, offset: 0 });
    expect(results).toHaveLength(1);
    expect(where).toHaveBeenCalled();
  });
});

// IMPORTANT: before writing this test, verify the actual chain order by reading
// the existing listPlayers function. If the order differs, mirror it here.
```

(This is a smoke test — it doesn't verify the actual SQL. Consider it documentation that the field flows through.)

- [ ] **Step 2: Update `ListPlayersFilters`**

In `playerService.ts`, find the `ListPlayersFilters` interface and add:

```ts
export interface ListPlayersFilters {
  factionId?: string;
  partyId?: string;
  isActive?: boolean;
  isStaff?: boolean;
  isAlive?: boolean;
  search?: string;       // NEW: case-insensitive substring on characterName OR discordUsername
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 3: Update `listPlayers` to apply the filter**

Find the `listPlayers` function in `playerService.ts`. Inside the WHERE-building section, add (alongside existing filter conditions):

```ts
import { ilike, or } from 'drizzle-orm';

// inside listPlayers:
const conditions: any[] = [];
// ... existing factionId/partyId/etc conditions ...
if (filters.search) {
  const term = `%${filters.search}%`;
  conditions.push(or(ilike(players.characterName, term), ilike(players.discordUsername, term)));
}
```

If `listPlayers` already has a different filter-conditions structure, integrate the search filter using the same pattern. Do NOT refactor the surrounding code.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hansard/api test:run playerService`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/playerService.ts packages/api/src/services/playerService.test.ts
git commit -m "feat(api): support search filter on listPlayers"
```

---

## Task 1.5: Wire `search` querystring through `/api/players`

**Files:**
- Modify: `packages/api/src/routes/players.ts`

- [ ] **Step 1: Read the existing `ListPlayersQuery` interface and route**

Run: `sed -n '25,80p' packages/api/src/routes/players.ts`

- [ ] **Step 2: Add `search?: string` to `ListPlayersQuery` and pass it through**

In `routes/players.ts`, update the `ListPlayersQuery` interface:

```ts
interface ListPlayersQuery {
  factionId?: string;
  partyId?: string;
  isActive?: string;
  isStaff?: string;
  isAlive?: string;
  search?: string;       // NEW
  limit?: string;
  offset?: string;
}
```

In the route handler, add:

```ts
if (q.search) filters.search = q.search;
```

(Alongside the existing `if (q.factionId) ...` block.)

- [ ] **Step 3: Manual smoke test (deferred)**

This endpoint is `requireAuth`-gated, so it can't be hit until Phase 2 is also complete and you can log in. Defer this manual check to **after** the Phase 2 verification block. At that point, log in via the browser, open DevTools → Console, and run:

```js
fetch('/api/players?search=al&limit=5').then(r => r.json()).then(console.log)
```

(The session cookie is automatic in the browser context. Skip the `curl --cookie` dance — Fastify's session cookie name varies by config and Windows PowerShell `curl` is an `Invoke-WebRequest` alias with different syntax.)

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/players.ts
git commit -m "feat(api): pass search query param to listPlayers"
```

---

## Task 1.6: Rewrite OAuth callback in `auth.ts`

**Files:**
- Modify: `packages/api/src/plugins/auth.ts`

- [ ] **Step 1: Read the existing file**

Run: `cat packages/api/src/plugins/auth.ts`

- [ ] **Step 2: Replace the callback handler**

Replace the entire `GET /api/auth/discord/callback` handler in `auth.ts` with:

```ts
fastify.get('/api/auth/discord/callback', async (request: FastifyRequest, reply: FastifyReply) => {
  const { code, error } = request.query as { code?: string; error?: string };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // Generic error redirect (covers access_denied, server_error, invalid_request, etc.)
  if (error) {
    return reply.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return reply.redirect(`${frontendUrl}/login?error=missing_code`);
  }

  try {
    // Exchange code for token
    const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      fastify.log.error('Discord token exchange failed: %s', tokenResponse.status);
      return reply.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json() as { access_token: string; token_type: string };

    // Fetch Discord profile
    const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      fastify.log.error('Discord user fetch failed: %s', userResponse.status);
      return reply.redirect(`${frontendUrl}/login?error=profile_fetch_failed`);
    }

    const discordUser = await userResponse.json() as {
      id: string;
      username: string;
      avatar: string | null;
    };

    // Find or create player; aggregate permissions
    const { player } = await findOrCreatePlayerByDiscordId(fastify.db, {
      discordId: discordUser.id,
      discordUsername: discordUser.username,
    });
    const permissions = await aggregatePermissionsForPlayer(fastify.db, player.id);

    request.session.user = {
      id: player.id,                        // players.id (UUID) — not Discord snowflake
      discordId: discordUser.id,
      username: player.discordUsername,
      avatar: discordUser.avatar,
      isStaff: player.isStaff,
      staffRole: player.staffRole,
      permissions,
    };

    return reply.redirect(`${frontendUrl}/`);
  } catch (err) {
    fastify.log.error(err, 'OAuth2 callback error');
    return reply.redirect(`${frontendUrl}/login?error=server_error`);
  }
});
```

Add the imports at the top of the file:

```ts
import { findOrCreatePlayerByDiscordId, aggregatePermissionsForPlayer } from '../services/playerService.js';
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm --filter @hansard/api build`
Expected: PASS (any prior compile errors from Task 1.1 should now be resolved).

- [ ] **Step 4: Manual smoke test deferred**

Real Discord OAuth requires running services. We'll do an end-to-end test after Phase 2 lands. For now, the type-check gives us confidence the wiring is correct.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/plugins/auth.ts
git commit -m "feat(api): rewrite OAuth callback with player lookup, permissions, error redirects"
```

---

## Task 1.7: Update `requireAuth` with player-staleness check

**Files:**
- Modify: `packages/api/src/middleware/requireAuth.ts`

- [ ] **Step 1: Read the existing middleware**

Run: `cat packages/api/src/middleware/requireAuth.ts`

- [ ] **Step 2: Rewrite to refetch player and validate**

Replace the file contents:

```ts
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import '../types.js';

/**
 * Fastify preHandler hook: requires a valid session AND a still-existing player row.
 * Populates request.player for downstream handlers (so they don't refetch).
 *
 * If the player has been deleted between login and this request, destroys the
 * session and returns 401 (prevents FK-violation crashes in mutations).
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = request.session.user;
  if (!user) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const fastify = request.server as FastifyInstance;
  const result = await fastify.db.select().from(players).where(eq(players.id, user.id)).limit(1);

  if (result.length === 0) {
    request.session.destroy();
    return reply.status(401).send({ error: 'Session player no longer exists' });
  }

  request.player = result[0];
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @hansard/api build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/middleware/requireAuth.ts
git commit -m "feat(api): requireAuth refetches player; populates request.player"
```

---

## Task 1.8: Add `prevWeek` to dashboard overview

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

- [ ] **Step 1: Read the current overview handler**

Run: `sed -n '20,105p' packages/api/src/routes/dashboard.ts`

- [ ] **Step 2: Compute prevWeek counts and extend the response**

Replace the body of `GET /api/dashboard/overview` with one that runs each `count()` twice — once for the current state and once with a `created_at < (now() - 7 days)` filter — then returns:

```ts
{
  activeTickets, upcomingVotes, playerCount, activeBills, activeModActions,
  currentSimTick, currentSimDate,
  prevWeek: {
    activeTickets: number,
    upcomingVotes: number,
    playerCount: number,
    activeBills: number,
    activeModActions: number,
  } | null,
}
```

Concrete pattern for one entity (apply to all five count metrics):

```ts
import { lt, sql } from 'drizzle-orm';

const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const [ticketResult] = await db
  .select({ value: count() })
  .from(tickets)
  .where(or(
    eq(tickets.status, 'open'),
    eq(tickets.status, 'in_progress'),
    eq(tickets.status, 'waiting'),
    eq(tickets.status, 'resolved'),
  ));

const [prevTicketResult] = await db
  .select({ value: count() })
  .from(tickets)
  .where(and(
    or(
      eq(tickets.status, 'open'),
      eq(tickets.status, 'in_progress'),
      eq(tickets.status, 'waiting'),
      eq(tickets.status, 'resolved'),
    ),
    lt(tickets.createdAt, sevenDaysAgo),
  ));
```

For sim tick: do not compute `prevWeek` (would need a tick-history table). Omit `simTick` from `prevWeek`.

If any single prev-query fails, wrap the whole prev-block in a try/catch and return `prevWeek: null` so the frontend falls back to no-trend display.

- [ ] **Step 3: Manual smoke test**

Start the API + DB: `pnpm dev:api` (and ensure Postgres is up). Hit:

```bash
curl 'http://localhost:3001/api/dashboard/overview' --cookie 'sess=YOUR_SESSION' | jq
```

Expected: response has `activeTickets`, `prevWeek.activeTickets`, etc.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/dashboard.ts
git commit -m "feat(api): add prevWeek counts to dashboard overview"
```

---

# Phase 2: Frontend auth foundation

## Task 2.1: Create `useAuth` hook

**Files:**
- Create: `packages/web/src/api/hooks/useAuth.ts`
- Create: `packages/web/src/api/hooks/useAuth.test.tsx`

- [ ] **Step 1: Write the failing test for the hook's query options**

Create `packages/web/src/api/hooks/useAuth.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuth } from './useAuth';

// Mock the api client
vi.mock('../client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: 1 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user and isStaff when authed', async () => {
    (api.get as any).mockResolvedValueOnce({
      id: 'p1', discordId: '123', username: 'alice',
      avatar: null, isStaff: true, staffRole: 'admin', permissions: ['call_elections'],
    });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user?.username).toBe('alice');
    expect(result.current.isStaff).toBe(true);
    expect(result.current.permissions).toEqual(['call_elections']);
    expect(result.current.hasPermission('call_elections')).toBe(true);
    expect(result.current.hasPermission('appoint_ministers')).toBe(false);
  });

  it('returns null user and false isStaff when 401', async () => {
    (api.get as any).mockRejectedValueOnce({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.isStaff).toBe(false);
    expect(result.current.permissions).toEqual([]);
  });

  it('does not retry on 401', async () => {
    (api.get as any).mockRejectedValue({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Despite global retry: 1, useAuth must opt out
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/web test:run useAuth`
Expected: FAIL with `Cannot find module './useAuth'`.

- [ ] **Step 3: Implement the hook**

Create `packages/web/src/api/hooks/useAuth.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export interface SessionUser {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth() {
  const qc = useQueryClient();

  const query = useQuery<SessionUser | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch (err: any) {
        if (err?.status === 401) return null;
        throw err;
      }
    },
    retry: false,            // 401 is normal state, not error
    throwOnError: false,
    staleTime: Infinity,     // re-fetched only via invalidation after login/logout
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout', {}),
    onSuccess: () => {
      qc.setQueryData(AUTH_QUERY_KEY, null);
      qc.clear();
    },
  });

  const user = query.data ?? null;

  return {
    user,
    isStaff: user?.isStaff ?? false,
    permissions: user?.permissions ?? [],
    hasPermission: (name: string) => user?.permissions.includes(name) ?? false,
    logout: logoutMutation.mutateAsync,
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hansard/web test:run useAuth`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/hooks/useAuth.ts packages/web/src/api/hooks/useAuth.test.tsx
git commit -m "feat(web): useAuth hook with retry: false and logout mutation"
```

---

## Task 2.2: Create `<AuthProvider>`

**Files:**
- Create: `packages/web/src/components/auth/AuthProvider.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { useAuth } from '../../api/hooks/useAuth';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Lightweight provider — its main job is to instantiate the useAuth query
 * once at the root so all consumers share its cache. The actual auth state
 * lives in TanStack Query, not React Context.
 *
 * (We don't use React Context here because TanStack Query already provides
 * the cross-component state via the QueryClient.)
 */
export function AuthProvider({ children }: AuthProviderProps) {
  // Touch the query to ensure it's instantiated before children render.
  useAuth();
  return <>{children}</>;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @hansard/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/auth/AuthProvider.tsx
git commit -m "feat(web): AuthProvider root wrapper"
```

---

## Task 2.3: Create `<Forbidden>` page

**Files:**
- Create: `packages/web/src/components/auth/Forbidden.tsx`

- [ ] **Step 1: Create the component**

```tsx
export function Forbidden() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-sm">
        <div className="text-2xl text-accent-moderation mb-3">✦</div>
        <h1 className="text-display mb-2">Out of bounds</h1>
        <p className="text-body text-text-secondary">
          You don't have access to this part of the chamber.
        </p>
        <p className="text-mono text-text-tertiary text-xs mt-6">
          If this seems wrong, ask staff to check your permissions.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/auth/Forbidden.tsx
git commit -m "feat(web): Forbidden 403 page"
```

---

## Task 2.4: Create `<RouteGuard>`

**Files:**
- Create: `packages/web/src/components/auth/RouteGuard.tsx`
- Create: `packages/web/src/components/auth/RouteGuard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `RouteGuard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RouteGuard } from './RouteGuard';
import * as authHook from '../../api/hooks/useAuth';

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

function renderWithQc(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RouteGuard', () => {
  it('renders skeleton while loading', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null, isStaff: false, permissions: [], hasPermission: () => false,
      logout: vi.fn(), isLoading: true,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-guard-skeleton')).toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null, isStaff: false, permissions: [], hasPermission: () => false,
      logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.getByTestId('navigate')).toHaveTextContent('/login');
  });

  it('renders children when authenticated', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  it('renders Forbidden when requireStaff but user is not staff', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard requireStaff><div>staff-only</div></RouteGuard>);
    expect(screen.queryByText('staff-only')).not.toBeInTheDocument();
    expect(screen.getByText(/Out of bounds/)).toBeInTheDocument();
  });

  it('renders children when requireStaff and user IS staff', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: true } as any, isStaff: true, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard requireStaff><div>staff-only</div></RouteGuard>);
    expect(screen.getByText('staff-only')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/web test:run RouteGuard`
Expected: FAIL with `Cannot find module './RouteGuard'`.

- [ ] **Step 3: Implement RouteGuard**

Create `packages/web/src/components/auth/RouteGuard.tsx`:

```tsx
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { PageSkeleton } from '../shared/SkeletonLoader';
import { Forbidden } from './Forbidden';

interface RouteGuardProps {
  requireStaff?: boolean;
  requirePermission?: string;
  children: React.ReactNode;
}

export function RouteGuard({ requireStaff, requirePermission, children }: RouteGuardProps) {
  const { user, isStaff, hasPermission, isLoading } = useAuth();

  if (isLoading) {
    return <div data-testid="route-guard-skeleton"><PageSkeleton /></div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (requireStaff && !isStaff) {
    return <Forbidden />;
  }

  if (requirePermission && !hasPermission(requirePermission)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hansard/web test:run RouteGuard`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/auth/RouteGuard.tsx packages/web/src/components/auth/RouteGuard.test.tsx
git commit -m "feat(web): RouteGuard component with skeleton + 403 fallback"
```

---

## Task 2.5: Create `<UserMenu>`

**Files:**
- Create: `packages/web/src/components/layout/UserMenu.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { useAuth } from '../../api/hooks/useAuth';
import { useNavigate } from '@tanstack/react-router';
import { PlayerAvatar } from '../shared/PlayerAvatar';

interface UserMenuProps {
  collapsed: boolean;
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { user, logout, isLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className={`px-4 py-3 border-t border-border-subtle ${collapsed ? 'flex justify-center' : ''}`}>
        <div className="w-7 h-7 rounded-full bg-bg-inset animate-pulse" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = user.username;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate({ to: '/login' });
  };

  return (
    <div className="border-t border-border-subtle relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-3 flex items-center gap-2 hover:bg-hover transition-colors ${collapsed ? 'justify-center' : ''}`}
        aria-label="User menu"
      >
        <PlayerAvatar player={{ id: user.id, characterName: null, discordUsername: displayName }} size="sm" />
        {!collapsed && (
          <>
            <span className="text-body-sm text-text-primary truncate flex-1 text-left">{displayName}</span>
            <span className="text-text-tertiary text-xs">▾</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-card border border-border-subtle rounded-card shadow-modal py-1 z-50">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-left text-body-sm text-text-primary hover:bg-hover"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

> Note: this references `<PlayerAvatar>`, which we create in Task 7.2. **Order matters:** complete Phase 7's PlayerAvatar before integrating UserMenu into Sidebar, OR ship UserMenu rendering an inline initials circle and refactor in Phase 7. To keep dependencies clean, **the executor should jump to Task 7.2 (create PlayerAvatar) before Task 2.6 (Sidebar wiring)**, then return to the normal order.

- [ ] **Step 2: Commit (component will not yet render in app — wired in Task 2.6)**

```bash
git add packages/web/src/components/layout/UserMenu.tsx
git commit -m "feat(web): UserMenu component (collapsed-aware)"
```

---

## Task 2.6: Modify Sidebar to hide Mod and render UserMenu

> **Pre-req: Task 7.2 (`<PlayerAvatar>` creation) must be complete.**

**Files:**
- Modify: `packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Read existing Sidebar**

Run: `cat packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 2: Modify the navigation list and footer**

Top of `Sidebar.tsx` — import `useAuth` and `UserMenu`:

```tsx
import { useAuth } from '../../api/hooks/useAuth';
import { UserMenu } from './UserMenu';
```

Inside the `Sidebar` component, after `currentPath`:

```tsx
const { isStaff, isLoading: authLoading } = useAuth();
```

Update `NAV_ITEMS.map(...)` rendering — wrap the Moderation item conditionally. The simplest approach: filter NAV_ITEMS:

```tsx
const visibleNavItems = NAV_ITEMS.filter((item) => {
  if (item.path === '/moderation') return isStaff && !authLoading;
  return true;
});
// ... then map over visibleNavItems instead of NAV_ITEMS
```

Replace the existing Footer block:

```tsx
{/* Footer — UserMenu replaces the static "DPS Season Manager" line */}
<UserMenu collapsed={collapsed} />
```

- [ ] **Step 3: Manual verify**

Run `pnpm dev:web` and `pnpm dev:api` (in two terminals). After Phase 2.7-2.8, log in. As a non-staff player, the Moderation entry should not appear. (For now we expect the auth flow not to be fully wired yet — defer this verify to end of Phase 2.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): Sidebar hides Moderation for non-staff; renders UserMenu"
```

---

## Task 2.7: Wire AuthProvider into `main.tsx`

**Files:**
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Wrap RouterProvider**

Update `main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { AuthProvider } from './components/auth/AuthProvider';
import './main.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/main.tsx
git commit -m "feat(web): wrap router in AuthProvider"
```

---

## Task 2.8: Wire RouteGuard into `router.tsx`

**Files:**
- Modify: `packages/web/src/router.tsx`

- [ ] **Step 1: Read the existing router fully**

Run: `cat packages/web/src/router.tsx`

You'll see ~16 route definitions, each `createRoute({ getParentRoute: () => rootRoute, path: '...', component: ... })`. The `routeTree` at the bottom adds them all to `rootRoute`. The existing imports include `createRouter`, `createRootRoute`, `createRoute`, `Outlet` from `@tanstack/react-router`. We'll keep all those.

You'll need to know the exact existing route variable names (e.g., `dashboardRoute`, `ticketsRoute`, `ticketDetailRoute`, `billsRoute`, `billDetailRoute`, `documentsRoute`, `votingRoute`, `electionDetailRoute`, `officesRoute`, `playersRoute`, `playerDetailRoute`, `favoursRoute`, `simulationRoute`, `moderationRoute`, `graveyardRoute`, `loginRoute`). Confirm in the file.

- [ ] **Step 2: Wrap protected routes**

The simplest approach: wrap the *root* layout `Shell` in a guard, leaving `/login` as the only unauthenticated route. Replace the rootRoute and add a separate route for `/login`:

```tsx
import { RouteGuard } from './components/auth/RouteGuard';
// ... existing imports ...

const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: () => (
    <RouteGuard>
      <Outlet />
    </RouteGuard>
  ),
});

const moderationLayoutRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  id: 'moderation-protected',
  component: () => (
    <RouteGuard requireStaff>
      <Outlet />
    </RouteGuard>
  ),
});

// /login is on rootRoute (NOT under protectedLayoutRoute):
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// Existing routes — change getParentRoute to protectedLayoutRoute:
const dashboardRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/',
  component: Dashboard,
});
// ... repeat: ticketsRoute, billsRoute, etc., all change to protectedLayoutRoute ...

// Moderation goes under moderationLayoutRoute (staff guard):
const moderationRoute = createRoute({
  getParentRoute: () => moderationLayoutRoute,
  path: '/moderation',
  component: Moderation,
});

// Update the route tree:
const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedLayoutRoute.addChildren([
    dashboardRoute,
    ticketsRoute,
    ticketDetailRoute,
    billsRoute,
    billDetailRoute,
    documentsRoute,
    votingRoute,
    electionDetailRoute,
    officesRoute,
    playersRoute,
    playerDetailRoute,
    favoursRoute,
    simulationRoute,
    graveyardRoute,
    moderationLayoutRoute.addChildren([
      moderationRoute,
    ]),
  ]),
]);
```

> Adjust to TanStack Router's exact pattern — the layout-route + Outlet pattern is the idiomatic way to apply guards to a group. If you prefer wrapping each route's component manually (`component: () => <RouteGuard><Dashboard /></RouteGuard>`), that's fine too — pick one pattern and apply consistently.

- [ ] **Step 3: Type-check and dev-server smoke**

Run: `pnpm --filter @hansard/web build`. Expected: PASS.

Run dev: `pnpm dev:web`. Visit http://localhost:5173 in an incognito window — you should be redirected to `/login`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router.tsx
git commit -m "feat(web): wrap protected routes in RouteGuard; staff guard on /moderation"
```

---

## Phase 2 verification (manual)

After Tasks 2.1-2.8 land (and Task 7.2 for `<PlayerAvatar>`), do an end-to-end auth test:

- [ ] Start API + web + DB: `docker compose up -d` (or your local equivalent)
- [ ] In an incognito browser, hit `http://localhost:5173/` → should redirect to `/login`
- [ ] Click Sign in with Discord → complete OAuth → land on `/`
- [ ] DB check: `SELECT id, discord_id, discord_username, is_staff FROM players WHERE discord_id = '<your-discord-id>'` — should have exactly one row
- [ ] Sidebar should show your username + avatar in footer
- [ ] If you are NOT staff in the DB: Moderation entry hidden in sidebar; visiting `/moderation` directly shows Forbidden page
- [ ] Manually `UPDATE players SET is_staff = true WHERE id = '<your-id>'`; clear browser cookies; log in again — Moderation now visible
- [ ] Click Sign out in UserMenu → redirected to `/login`

If any of these fail, fix before moving on.

---

# Phase 3: Permission gating sweep

For each page in this phase, the pattern is:
1. Import `useAuth`
2. Read `isStaff` (and `hasPermission` where needed) at the top
3. Wrap each staff-only control in `{isStaff && ...}` (or `{hasPermission('x') && ...}`)
4. Replace any `// TODO: Replace with real auth context` markers
5. Manually verify in dev with the gated buttons hidden for non-staff and visible for staff

---

## Task 3.1: Gate Favours page

**Files:**
- Modify: `packages/web/src/pages/Favours.tsx`

- [ ] **Step 1: Read the file to find action controls**

Run: `cat packages/web/src/pages/Favours.tsx`

Identify: grant form, spend form, remove form, global history (vs own balance).

- [ ] **Step 2: Replace `// TODO` actor stub with `useAuth`**

```tsx
import { useAuth } from '../api/hooks/useAuth';

// Inside the component:
const { user, isStaff } = useAuth();
// Use user!.id wherever the TODO previously used a stub actor ID.
// (The RouteGuard ensures user is non-null here.)
```

- [ ] **Step 3: Wrap staff-only sections**

Wrap grant/spend/remove forms and the "all balances / global history" panel in:

```tsx
{isStaff && (
  <>
    {/* the form / panel */}
  </>
)}
```

Keep "your own balance" visible to all authed users.

- [ ] **Step 4: Manual verify**

Log in as non-staff: forms hidden. Log in as staff (`UPDATE players SET is_staff=true`): forms visible.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/Favours.tsx
git commit -m "feat(web): gate Favours staff-only forms with useAuth"
```

---

## Task 3.2: Gate Simulation page

**Files:**
- Modify: `packages/web/src/pages/Simulation.tsx`

- [ ] **Step 1: Apply the same pattern as Task 3.1**

- Import `useAuth`; replace `// TODO: Replace with real auth hook` with `const { user, isStaff } = useAuth();`
- Wrap each form (tick-advance, ailment, death, heal) in `{isStaff && ...}`
- Page itself stays read-only viewable to all

- [ ] **Step 2: Manual verify**

Non-staff: page renders, no action forms. Staff: all forms visible.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Simulation.tsx
git commit -m "feat(web): gate Simulation staff-only forms"
```

---

## Task 3.3: Gate BillDetail page

**Files:**
- Modify: `packages/web/src/pages/BillDetail.tsx`

- [ ] **Step 1: Identify controls to gate**

Read the file. Look for:
- Enact button → `isStaff`
- Repeal button → `isStaff`
- Edit-effects → `isStaff`
- NPC-vote → `isStaff`
- Edit-bill → `isStaff || bill.authorId === user.id`
- Cache-content → `isStaff || bill.authorId === user.id`
- Create-vote → `hasPermission('legislative_leader')`

- [ ] **Step 2: Wire `useAuth` and apply gates**

```tsx
const { user, isStaff, hasPermission } = useAuth();
const isAuthor = bill?.authorId === user?.id;

// then:
{isStaff && <button>Enact</button>}
{isStaff && <button>Repeal</button>}
{isStaff && <button>Edit effects</button>}
{isStaff && <button>NPC Vote</button>}
{(isStaff || isAuthor) && <button>Edit</button>}
{(isStaff || isAuthor) && <button>Cache content</button>}
{hasPermission('legislative_leader') && <button>Create vote</button>}
```

- [ ] **Step 3: Manual verify**

For each role (own-author, other-player, staff, legislative_leader-office-holder), confirm the right buttons appear.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/BillDetail.tsx
git commit -m "feat(web): gate BillDetail controls (isStaff/author/legislative_leader)"
```

---

## Task 3.4: Gate ElectionDetail page

**Files:**
- Modify: `packages/web/src/pages/ElectionDetail.tsx`

- [ ] **Step 1: Apply gates**

```tsx
const { isStaff } = useAuth();
// ...
{isStaff && <button>Certify</button>}
{isStaff && <button>NPC Confirm</button>}
```

**Important: do NOT touch the candidate bar chart at lines ~239-269.** Limit changes to wrapping action buttons.

- [ ] **Step 2: Manual verify**

Non-staff sees vote results + chart, no certify/NPC buttons. Staff sees both.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/ElectionDetail.tsx
git commit -m "feat(web): gate ElectionDetail certify/NPC controls"
```

---

## Task 3.5: Gate CharacterDossier page (top-level only)

**Files:**
- Modify: `packages/web/src/pages/CharacterDossier.tsx`

> **Important: this file is 668 lines.** Limit changes to the top-level action bar / header. Do NOT modify tab logic or inline subcomponents.

- [ ] **Step 1: Read the top-level header area**

Run: `sed -n '1,150p' packages/web/src/pages/CharacterDossier.tsx`

Locate the action buttons (kill, heal, edit, mod-history) typically rendered in the page header.

- [ ] **Step 2: Apply gates**

```tsx
const { isStaff } = useAuth();

// In the header buttons block:
{isStaff && <button>Edit Character</button>}
{isStaff && <button>Heal</button>}
{isStaff && <button>Kill</button>}
{isStaff && <button>View Mod History</button>}
```

If "Mod History" is rendered as a tab rather than a button, gate the tab definition similarly: only include the mod-history tab in the tab list when `isStaff`.

- [ ] **Step 3: Manual verify**

Visit `/players/<some-uuid>` as non-staff — only public dossier visible. As staff — all controls visible.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/CharacterDossier.tsx
git commit -m "feat(web): gate CharacterDossier staff-only header controls"
```

---

## Task 3.6: Gate TicketDetail Close button

**Files:**
- Modify: `packages/web/src/pages/TicketDetail.tsx`

- [ ] **Step 1: Identify the Close button (around line 64-71 per the spec review)**

Run: `sed -n '60,80p' packages/web/src/pages/TicketDetail.tsx`

- [ ] **Step 2: Gate the button**

```tsx
const { user, isStaff } = useAuth();
const isCreator = ticket?.createdById === user?.id;

// Replace existing Close button render with:
{(isStaff || isCreator) && <button>Close Ticket</button>}
```

- [ ] **Step 3: Manual verify**

As ticket creator: Close visible. As unrelated non-staff player: Close hidden. As staff: Close visible.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/TicketDetail.tsx
git commit -m "feat(web): gate TicketDetail Close button to creator-or-staff"
```

---

## Task 3.7: Gate Documents rollback

**Files:**
- Modify: `packages/web/src/pages/Documents.tsx`

- [ ] **Step 1: Locate the rollback button (~line 157-172 per spec review)**

Run: `sed -n '150,180p' packages/web/src/pages/Documents.tsx`

- [ ] **Step 2: Gate the button (do NOT touch surrounding `VersionHistoryPanel` logic)**

```tsx
const { isStaff } = useAuth();
// ...
{isStaff && <button>Rollback to this version</button>}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Documents.tsx
git commit -m "feat(web): gate Documents rollback button"
```

---

# Phase 4: Login redesign

## Task 4.1: Add parchment CSS classes

**Files:**
- Modify: `packages/web/src/main.css`

- [ ] **Step 1: Read existing CSS**

Run: `cat packages/web/src/main.css`

- [ ] **Step 2: Add new classes at the end**

Append:

```css
/* === Login parchment === */
.bg-parchment {
  background: linear-gradient(180deg, #FAF9F5 0%, #F5E6DF 100%);
}

.parchment-frame {
  position: relative;
}

.parchment-frame::before,
.parchment-frame::after {
  content: '';
  position: absolute;
  pointer-events: none;
  border-radius: 4px;
}

.parchment-frame::before {
  inset: 12px;
  border: 1px solid #D4D1C7;
}

.parchment-frame::after {
  inset: 18px;
  border: 1px solid #E8E6DC;
}

/* === Hairline rule === */
.rule {
  border: 0;
  border-top: 1px solid #E8E6DC;
  margin: 1.5rem 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/main.css
git commit -m "feat(web): add parchment + rule classes for Login redesign"
```

---

## Task 4.2: Rewrite Login page

**Files:**
- Modify: `packages/web/src/pages/Login.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useSearch } from '@tanstack/react-router';

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Sign-in cancelled. Try again when you\'re ready.',
};

export function Login() {
  const apiUrl = import.meta.env.VITE_API_URL || '/api';
  const search = useSearch({ strict: false }) as { error?: string };
  const errorCode = search?.error;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? `Discord rejected the sign-in (${errorCode}). Try again.`)
    : null;

  return (
    <div className="bg-parchment min-h-screen flex items-center justify-center p-6">
      <div className="parchment-frame w-full max-w-md py-16 px-12 text-center">
        <div className="text-mono text-text-tertiary text-xs tracking-[0.15em] uppercase mb-6">
          — Per Order of the Chamber —
        </div>

        <h1 className="font-display italic text-[2.5rem] leading-tight text-text-primary mb-4">
          Hansard
        </h1>

        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-8 bg-border-strong" />
          <div className="text-border-strong text-base">✦</div>
          <div className="h-px w-8 bg-border-strong" />
        </div>

        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed">
          "Be it known that the record of these proceedings is faithfully kept."
        </p>

        {errorMessage && (
          <p className="text-body-sm italic text-status-rejected mb-4">
            {errorMessage}
          </p>
        )}

        <a href={`${apiUrl}/auth/discord`} className="btn-primary inline-block">
          Sign in with Discord
        </a>

        <p className="text-mono text-text-tertiary text-xs tracking-wider mt-8">
          DPS · SEASON MANAGER
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verify**

Run `pnpm dev:web`. Visit `/login` (logged out) — confirm parchment look. Visit `/login?error=denied` — confirm inline error notice.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Login.tsx
git commit -m "feat(web): redesign Login page with ceremonial parchment aesthetic"
```

---

# Phase 5: Dashboard

## Task 5.1: Create trend delta formatter (TDD)

**Files:**
- Create: `packages/web/src/components/dashboard/trendFormat.ts`
- Create: `packages/web/src/components/dashboard/trendFormat.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/web/src/components/dashboard/trendFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatTrendDelta } from './trendFormat';

describe('formatTrendDelta', () => {
  it('formats positive deltas with + prefix', () => {
    expect(formatTrendDelta(7, 5)).toBe('+2 this week');
    expect(formatTrendDelta(1, 0)).toBe('+1 this week');
  });

  it('formats negative deltas with real minus glyph', () => {
    expect(formatTrendDelta(3, 8)).toBe('−5 this week');
    expect(formatTrendDelta(0, 1)).toBe('−1 this week');
  });

  it('formats zero delta as "no change"', () => {
    expect(formatTrendDelta(5, 5)).toBe('— no change');
    expect(formatTrendDelta(0, 0)).toBe('— no change');
  });

  it('returns null when prevWeek is missing', () => {
    expect(formatTrendDelta(5, undefined)).toBeNull();
    expect(formatTrendDelta(5, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/web test:run trendFormat`
Expected: FAIL.

- [ ] **Step 3: Implement the function**

Create `packages/web/src/components/dashboard/trendFormat.ts`:

```ts
/**
 * Format a trend delta string for the dashboard metric cards.
 * - positive: '+N this week'
 * - negative: '−N this week' (real U+2212 minus, not hyphen)
 * - zero: '— no change'
 * - prevWeek null/undefined: returns null (caller should hide the line)
 */
export function formatTrendDelta(current: number, prev: number | null | undefined): string | null {
  if (prev === null || prev === undefined) return null;
  const delta = current - prev;
  if (delta === 0) return '— no change';
  if (delta > 0) return `+${delta} this week`;
  return `−${Math.abs(delta)} this week`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hansard/web test:run trendFormat`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/dashboard/trendFormat.ts packages/web/src/components/dashboard/trendFormat.test.ts
git commit -m "feat(web): trend delta formatter with all four cases"
```

---

## Task 5.2: Create `useDashboard` hooks

**Files:**
- Create: `packages/web/src/api/hooks/useDashboard.ts`

- [ ] **Step 1: Create the file**

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface DashboardOverview {
  activeTickets: number;
  upcomingVotes: number;
  playerCount: number;
  activeBills: number;
  activeModActions: number;
  currentSimTick: number;
  currentSimDate: string | null;
  prevWeek: {
    activeTickets: number;
    upcomingVotes: number;
    playerCount: number;
    activeBills: number;
    activeModActions: number;
  } | null;
}

export interface DashboardActivityItem {
  type: string;
  system: 'tickets' | 'bills' | 'players' | 'moderation' | string;
  description: string;
  timestamp: string;
  actorName: string | null;
}

export function useDashboardOverview() {
  return useQuery<DashboardOverview>({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/dashboard/overview'),
    staleTime: 30_000,
  });
}

export function useDashboardActivity() {
  return useQuery<DashboardActivityItem[]>({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api.get<DashboardActivityItem[]>('/dashboard/activity'),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @hansard/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/hooks/useDashboard.ts
git commit -m "feat(web): useDashboardOverview + useDashboardActivity hooks"
```

---

## Task 5.3: Create `<ActivityFeed>` component

**Files:**
- Create: `packages/web/src/components/dashboard/ActivityFeed.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { DashboardActivityItem } from '../../api/hooks/useDashboard';
import { PlayerAvatar } from '../shared/PlayerAvatar';

interface ActivityFeedProps {
  items: DashboardActivityItem[];
}

const SYSTEM_LABELS: Record<string, { label: string; color: string }> = {
  bills:      { label: 'Legislature',  color: 'border-accent-bills      text-accent-bills' },
  tickets:    { label: 'Tickets',      color: 'border-accent-tickets    text-accent-tickets' },
  players:    { label: 'Players',      color: 'border-accent-players    text-accent-players' },
  moderation: { label: 'Moderation',   color: 'border-accent-moderation text-accent-moderation' },
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-2xl text-accent-primary mb-2">✦</div>
        <p className="text-body-sm italic text-text-secondary">
          All quiet on the chamber floor.
        </p>
      </div>
    );
  }

  // Group by system, preserving order within each group
  const groups = new Map<string, DashboardActivityItem[]>();
  for (const item of items) {
    const key = item.system;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([system, sectionItems]) => {
        const meta = SYSTEM_LABELS[system] ?? { label: system, color: 'border-border-default text-text-secondary' };
        const [borderClass, textClass] = meta.color.split(/\s+/);
        return (
          <section key={system}>
            <div className={`border-l-2 ${borderClass} pl-2 mb-2`}>
              <span className={`text-mono text-xs uppercase tracking-wider font-semibold ${textClass}`}>
                {meta.label}
              </span>
            </div>
            <div className="space-y-1">
              {sectionItems.map((item, idx) => {
                // Activity feed items only carry actorName (no UUID), so we hash by
                // name. Consequence: the same player may show a different color in
                // the feed vs in pages that hash by player.id. Acceptable — feed is
                // historical context, exact color match across surfaces isn't critical.
                const actorKey = item.actorName ?? 'unknown';
                return (
                  <div
                    key={`${item.timestamp}-${idx}`}
                    className="card flex items-center gap-3 px-3 py-2 transition-colors duration-150 ease-out"
                  >
                    <PlayerAvatar
                      player={{
                        id: actorKey,
                        characterName: null,
                        discordUsername: actorKey,
                      }}
                      size="sm"
                    />
                    <div className="flex-1 text-body-sm text-text-secondary">{item.description}</div>
                    <div className="text-mono text-xs text-text-tertiary">{relativeTime(item.timestamp)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @hansard/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/dashboard/ActivityFeed.tsx
git commit -m "feat(web): ActivityFeed component with system grouping + relative times"
```

---

## Task 5.4: Rewrite Dashboard page

**Files:**
- Modify: `packages/web/src/pages/Dashboard.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useDashboardOverview, useDashboardActivity } from '../api/hooks/useDashboard';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import { formatTrendDelta } from '../components/dashboard/trendFormat';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

interface MetricDef {
  key: string;
  label: string;
  current: number;
  prev: number | null;
  color: string;
  borderColor: string;
  fallback?: string;
}

export function Dashboard() {
  const { data: overview, isLoading: overviewLoading } = useDashboardOverview();
  const { data: activity, isLoading: activityLoading } = useDashboardActivity();

  if (overviewLoading || activityLoading) return <PageSkeleton />;
  if (!overview) return null;

  const metrics: MetricDef[] = [
    {
      key: 'tickets', label: 'Active Tickets',
      current: overview.activeTickets, prev: overview.prevWeek?.activeTickets ?? null,
      color: 'text-accent-tickets', borderColor: 'border-l-accent-tickets',
    },
    {
      key: 'bills', label: 'Open Bills',
      current: overview.activeBills, prev: overview.prevWeek?.activeBills ?? null,
      color: 'text-accent-bills', borderColor: 'border-l-accent-bills',
    },
    {
      key: 'votes', label: 'Upcoming Votes',
      current: overview.upcomingVotes, prev: overview.prevWeek?.upcomingVotes ?? null,
      color: 'text-accent-voting', borderColor: 'border-l-accent-voting',
    },
    {
      key: 'players', label: 'Active Players',
      current: overview.playerCount, prev: overview.prevWeek?.playerCount ?? null,
      color: 'text-accent-players', borderColor: 'border-l-accent-players',
    },
    {
      key: 'moderation', label: 'Active Mod Actions',
      current: overview.activeModActions, prev: overview.prevWeek?.activeModActions ?? null,
      color: 'text-accent-moderation', borderColor: 'border-l-accent-moderation',
    },
    {
      key: 'sim', label: 'Simulation Tick',
      current: overview.currentSimTick, prev: null,    // sim tick gets sim-date instead
      color: 'text-accent-simulation', borderColor: 'border-l-accent-simulation',
      fallback: overview.currentSimDate ?? '',
    },
  ];

  return (
    <div className="p-8">
      <h1 className="text-display mb-2">Dashboard</h1>
      <p className="text-body-sm text-text-tertiary mb-8 italic">The morning briefing.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {metrics.map((m) => {
          const trend = formatTrendDelta(m.current, m.prev);
          return (
            <div key={m.key} className={`card ${m.borderColor} border-l-[3px]`}>
              <p className="text-label text-text-tertiary mb-2 uppercase">{m.label}</p>
              <p className={`text-mono text-2xl font-normal ${m.color}`}>{m.current}</p>
              <p className="text-mono text-xs text-text-tertiary mt-1">
                {trend ?? m.fallback ?? ''}
              </p>
            </div>
          );
        })}
      </div>

      <hr className="rule" />

      <div className="max-w-3xl">
        <h2 className="text-heading-1 mb-4">Recent Activity</h2>
        <ActivityFeed items={activity ?? []} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verify**

Start API + web. Log in. Visit `/`. Confirm:
- Six metric cards show real numbers
- Trend deltas appear on cards with prevWeek data
- Sim tick card shows sim date
- Activity feed shows grouped items (or empty state if DB is fresh)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Dashboard.tsx
git commit -m "feat(web): rewrite Dashboard with hooked-up data, trend deltas, grouped activity feed"
```

---

# Phase 6: Moderation modal

## Task 6.1: Export `useSearchPlayers` convenience

**Files:**
- Modify: `packages/web/src/api/hooks/usePlayers.ts`

- [ ] **Step 1: Add convenience export**

At the bottom of `usePlayers.ts`:

```ts
/**
 * Convenience for player typeahead. Disabled when search is empty/short
 * to avoid spamming the API on every keystroke.
 */
export function useSearchPlayers(search: string, limit = 8) {
  return usePlayers(search.length >= 2 ? { search, limit } : undefined);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/api/hooks/usePlayers.ts
git commit -m "feat(web): useSearchPlayers convenience hook"
```

---

## Task 6.2: Add optimistic insert to `useCreateModAction`

**Files:**
- Modify: `packages/web/src/api/hooks/useModeration.ts`

- [ ] **Step 1: Locate the existing `useCreateModAction`**

It's in `useModeration.ts` around line 81-91. Currently uses `onSuccess` to invalidate queries. Replace it with a version that does optimistic insert.

- [ ] **Step 2: Replace the implementation**

Replace `useCreateModAction` with:

```ts
export function useCreateModAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      targetPlayerId: string;
      type: string;
      reason: string;
      internalNotes?: string;
      expiresAt?: string;
    }) => api.post<ModAction>('/moderation/actions', body),

    onMutate: async (vars) => {
      // Cancel outgoing refetches so optimistic data isn't overwritten
      await qc.cancelQueries({ queryKey: ['moderation', 'actions'] });

      // Snapshot prior list-cache entries
      const snapshots = qc.getQueriesData<{ data: ModAction[]; total: number }>({
        queryKey: ['moderation', 'actions'],
      });

      // Optimistically prepend a pending action to all matching list caches
      const optimistic: ModAction = {
        id: `optimistic-${Date.now()}`,
        targetPlayerId: vars.targetPlayerId,
        moderatorId: 'pending',
        type: vars.type as ModAction['type'],
        reason: vars.reason,
        internalNotes: vars.internalNotes,
        expiresAt: vars.expiresAt,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      for (const [key, value] of snapshots) {
        if (value) {
          qc.setQueryData(key, {
            ...value,
            data: [optimistic, ...value.data],
            total: value.total + 1,
          });
        }
      }

      return { snapshots };
    },

    onError: (_err, _vars, context) => {
      // Roll back to the snapshots
      for (const [key, value] of context?.snapshots ?? []) {
        qc.setQueryData(key, value);
      }
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['moderation'] });
      qc.invalidateQueries({ queryKey: ['players', vars.targetPlayerId] });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/hooks/useModeration.ts
git commit -m "feat(web): optimistic insert for useCreateModAction"
```

---

## Task 6.3: Create `<ModActionModal>` component

**Files:**
- Create: `packages/web/src/components/shared/ModActionModal.tsx`

> Note: this is the largest single component in the plan. It has form state, validation, typeahead, duration chips, and three modes. Consider splitting development into sub-steps if helpful, but the file should ship as one unit.

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect, useRef } from 'react';
import { useSearchPlayers } from '../../api/hooks/usePlayers';
import { useCreateModAction } from '../../api/hooks/useModeration';
import { PlayerAvatar } from './PlayerAvatar';

type ModType = 'warn' | 'mute' | 'suspend';

interface ModActionModalProps {
  type: ModType;
  onClose: () => void;
}

const TITLES: Record<ModType, string> = {
  warn: 'Issue Warning',
  mute: 'Issue Mute',
  suspend: 'Issue Suspension',
};

const TYPE_LABELS: Record<ModType, string> = {
  warn: 'Warn',
  mute: 'Mute',
  suspend: 'Suspend',
};

const RAIL_COLOR: Record<ModType, string> = {
  warn: 'bg-status-pending',
  mute: 'bg-accent-tickets',
  suspend: 'bg-accent-moderation',
};

const SUBMIT_COLOR: Record<ModType, string> = {
  warn: 'bg-status-pending hover:bg-status-pending/90',
  mute: 'bg-accent-tickets hover:bg-accent-tickets/90',
  suspend: 'bg-accent-moderation hover:bg-accent-moderation/90',
};

const DURATION_PRESETS = [
  { label: '1h',         ms: 60 * 60 * 1000 },
  { label: '24h',        ms: 24 * 60 * 60 * 1000 },
  { label: '7d',         ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d',        ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'Permanent',  ms: null as number | null },
];

interface SelectedPlayer {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

export function ModActionModal({ type, onClose }: ModActionModalProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);
  const [warnSubtype, setWarnSubtype] = useState<'verbal_warning' | 'formal_warning'>('verbal_warning');
  const [durationMs, setDurationMs] = useState<number | null>(24 * 60 * 60 * 1000); // default 24h
  const [customMode, setCustomMode] = useState(false);
  const [customExpiry, setCustomExpiry] = useState('');
  const [reason, setReason] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { data: searchResults } = useSearchPlayers(search);
  const createAction = useCreateModAction();

  // Close on Escape; click-outside-to-close handled by overlay onClick
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apiType = type === 'warn'
    ? warnSubtype
    : type === 'mute' ? 'mute' : 'temporary_suspension';

  const handleSubmit = async () => {
    setError(null);
    if (!selected) { setError('Pick a target player.'); return; }
    if (reason.trim().length < 8) { setError('Reason must be at least 8 characters.'); return; }

    let expiresAt: string | undefined;
    if (type !== 'warn') {
      if (customMode) {
        if (!customExpiry) { setError('Pick a custom expiry, or use a preset.'); return; }
        expiresAt = new Date(customExpiry).toISOString();
      } else if (durationMs !== null) {
        expiresAt = new Date(Date.now() + durationMs).toISOString();
      }
      // null durationMs and not customMode = Permanent (no expiresAt)
    }

    try {
      await createAction.mutateAsync({
        targetPlayerId: selected.id,
        type: apiType,
        reason: reason.trim(),
        internalNotes: internalNotes.trim() || undefined,
        expiresAt,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not submit. Try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="bg-card rounded-card shadow-modal-warm w-full max-w-md overflow-hidden">
        <div className={`h-[3px] ${RAIL_COLOR[type]}`} />
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <div className="text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
                {TYPE_LABELS[type]}
              </div>
              <h2 className="text-heading-1 text-text-primary">{TITLES[type]}</h2>
            </div>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl leading-none">×</button>
          </div>

          {/* Target */}
          <div className="mb-4">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Target Player
            </label>
            {selected ? (
              <div className="flex items-center gap-2 bg-card border border-border-default rounded-card px-3 py-2">
                <PlayerAvatar player={selected} size="sm" />
                <span className="text-body-sm text-text-primary">{selected.characterName ?? selected.discordUsername}</span>
                <span className="text-mono text-xs text-text-tertiary ml-auto">@{selected.discordUsername}</span>
                <button onClick={() => { setSelected(null); setSearch(''); }} className="ml-2 text-text-tertiary text-xs hover:text-status-rejected">change</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name..."
                  autoFocus
                  className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary"
                />
                {searchResults?.data && searchResults.data.length > 0 && (
                  <div className="mt-1 border border-border-subtle rounded-card overflow-hidden">
                    {searchResults.data.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => setSelected({ id: p.id, characterName: p.characterName, discordUsername: p.discordUsername })}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left"
                      >
                        <PlayerAvatar player={p} size="sm" />
                        <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                        <span className="text-mono text-xs text-text-tertiary ml-auto">@{p.discordUsername}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Warn subtype */}
          {type === 'warn' && (
            <div className="mb-4">
              <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-2">Type</label>
              <div className="flex gap-3">
                {(['verbal_warning', 'formal_warning'] as const).map((sub) => (
                  <label key={sub} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={warnSubtype === sub} onChange={() => setWarnSubtype(sub)} />
                    <span className="text-body-sm">{sub === 'verbal_warning' ? 'Verbal' : 'Formal'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Duration */}
          {type !== 'warn' && (
            <div className="mb-4">
              <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-2">Duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => {
                  const active = !customMode && durationMs === preset.ms;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => { setDurationMs(preset.ms); setCustomMode(false); }}
                      className={`text-body-sm px-3 py-1 rounded-card border transition-colors ${active ? 'bg-accent-primary-light border-accent-primary text-accent-primary font-medium' : 'bg-card border-border-default text-text-secondary hover:border-accent-primary'}`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCustomMode(true)}
                  className={`text-body-sm px-3 py-1 rounded-card border-dashed border transition-colors ${customMode ? 'border-accent-primary text-accent-primary' : 'border-border-strong text-text-tertiary hover:border-accent-primary'}`}
                >
                  Custom…
                </button>
              </div>
              {customMode && (
                <input
                  type="datetime-local"
                  value={customExpiry}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  className="mt-2 bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary"
                />
              )}
            </div>
          )}

          {/* Reason */}
          <div className="mb-4">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Reason <span className="text-status-rejected">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Required, at least 8 characters."
              className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary resize-y"
            />
          </div>

          {/* Internal notes */}
          <div className="mb-5">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Internal notes <span className="italic text-border-strong normal-case">staff only</span>
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="optional…"
              className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary resize-y"
            />
          </div>

          {error && (
            <p className="text-body-sm text-status-rejected mb-3">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={createAction.isPending}
              className={`px-4 py-1.5 rounded-card text-text-inverse font-medium ${SUBMIT_COLOR[type]} disabled:opacity-50`}
            >
              {createAction.isPending ? 'Submitting…' : TITLES[type].replace('Issue ', '')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @hansard/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/shared/ModActionModal.tsx
git commit -m "feat(web): ModActionModal component (3 modes, typeahead, duration chips, optimistic submit)"
```

---

## Task 6.4: Wire ModActionModal into Moderation page

**Files:**
- Modify: `packages/web/src/pages/Moderation.tsx`

- [ ] **Step 1: Replace ModalStub usage**

In `Moderation.tsx`:
- Remove the `ModalStub` definition entirely
- Import: `import { ModActionModal } from '../components/shared/ModActionModal';`
- Replace the `{modal && <ModalStub title=... onClose=... />}` block with:

```tsx
{modal && (
  <ModActionModal
    type={modal}
    onClose={() => setModal(null)}
  />
)}
```

- [ ] **Step 2: Manual verify**

Log in as staff. Click Warn → modal opens. Type a player name → typeahead appears. Pick a target. Type a reason (>= 8 chars). Submit → list updates. Try Mute and Suspend modes; verify duration chips work and Custom datetime works.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Moderation.tsx
git commit -m "feat(web): wire ModActionModal into Moderation page; remove ModalStub"
```

---

# Phase 7: Polish sweep

## Task 7.1: Extend Tailwind with `shadow-modal-warm`

**Files:**
- Modify: `packages/web/tailwind.config.ts`

- [ ] **Step 1: Update boxShadow**

In `tailwind.config.ts`, locate the `boxShadow` block and update:

```ts
boxShadow: {
  modal: '0 4px 12px rgba(20, 20, 19, 0.08)',
  'modal-warm': '0 8px 32px rgba(120, 90, 60, 0.18)',
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/tailwind.config.ts
git commit -m "feat(web): add shadow-modal-warm Tailwind utility"
```

---

## Task 7.2: Create `<PlayerAvatar>` component (with TDD on hash)

> **Pre-req for Tasks 2.5 / 2.6 / 5.3 / 6.3 — complete this BEFORE wiring those into the UI.**

**Files:**
- Create: `packages/web/src/components/shared/PlayerAvatar.tsx`
- Create: `packages/web/src/components/shared/PlayerAvatar.test.tsx`

- [ ] **Step 1: Write failing tests for the color hash**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlayerAvatar, colorForId } from './PlayerAvatar';

describe('colorForId', () => {
  it('is deterministic — same id yields same color', () => {
    expect(colorForId('abc')).toBe(colorForId('abc'));
  });

  it('different ids land in the palette', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const seen = new Set(ids.map(colorForId));
    expect(seen.size).toBeGreaterThan(1); // not always the same color
  });
});

describe('PlayerAvatar', () => {
  it('renders the first character of characterName uppercased', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: 'aldrick vance', discordUsername: 'aldrick.v' }} size="sm" />,
    );
    expect(getByText('A')).toBeInTheDocument();
  });

  it('falls back to discordUsername when characterName is null', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: null, discordUsername: 'bob' }} size="sm" />,
    );
    expect(getByText('B')).toBeInTheDocument();
  });

  it('renders ? when both names are missing', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: null, discordUsername: '' }} size="sm" />,
    );
    expect(getByText('?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hansard/web test:run PlayerAvatar`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
const PALETTE = [
  'bg-accent-bills',
  'bg-accent-voting',
  'bg-accent-players',
  'bg-accent-offices',
  'bg-accent-tickets',
  'bg-accent-simulation',
  'bg-accent-graveyard',
] as const;

/**
 * Deterministic color from id by hashing characters mod palette length.
 */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

interface PlayerAvatarProps {
  player: {
    id: string;
    characterName: string | null;
    discordUsername: string;
  };
  size?: 'sm' | 'md';
}

export function PlayerAvatar({ player, size = 'sm' }: PlayerAvatarProps) {
  const initial = (player.characterName ?? player.discordUsername ?? '')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

  const sizeClasses = size === 'sm'
    ? 'w-[18px] h-[18px] text-[10px]'
    : 'w-8 h-8 text-sm';

  const color = colorForId(player.id);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-text-inverse font-semibold ${sizeClasses} ${color}`}
      aria-label={player.characterName ?? player.discordUsername ?? 'Player'}
    >
      {initial}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hansard/web test:run PlayerAvatar`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/shared/PlayerAvatar.tsx packages/web/src/components/shared/PlayerAvatar.test.tsx
git commit -m "feat(web): PlayerAvatar component with deterministic color hash"
```

---

## Task 7.3: Replace 5 ad-hoc avatar implementations

**Files:**
- Modify: `packages/web/src/pages/Players.tsx`
- Modify: `packages/web/src/pages/CharacterDossier.tsx`
- Modify: `packages/web/src/pages/Offices.tsx`

- [ ] **Step 1: Players.tsx — remove `InitialsCircle` definition**

Open `packages/web/src/pages/Players.tsx`. Lines ~21-41 define `InitialsCircle`. Delete that definition. Also delete lines ~223-234 (inline ad-hoc avatar). Replace both call sites with `<PlayerAvatar player={player} size="sm" />`.

Add at top: `import { PlayerAvatar } from '../components/shared/PlayerAvatar';`

- [ ] **Step 2: CharacterDossier.tsx — remove duplicate `InitialsCircle`**

Lines ~50-70 define another `InitialsCircle`. Delete it. Lines ~118-129 are an inline ad-hoc render. Replace both with `<PlayerAvatar>`.

Add the import.

- [ ] **Step 3: Offices.tsx — replace inline avatar**

Lines ~86-98 are an inline ad-hoc avatar. Replace with `<PlayerAvatar>`.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @hansard/web build`. Expected: PASS.

- [ ] **Step 5: Manual verify**

Browse to Players page, click into a dossier, visit Offices. Avatars should look the same as before (initial circles in earth tones), just consolidated.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/Players.tsx packages/web/src/pages/CharacterDossier.tsx packages/web/src/pages/Offices.tsx
git commit -m "refactor(web): replace 5 ad-hoc avatar implementations with <PlayerAvatar>"
```

---

## Task 7.4: Empty-state copy across list pages

**Files:**
- Modify: `packages/web/src/pages/Bills.tsx`
- Modify: `packages/web/src/pages/Tickets.tsx`
- Modify: `packages/web/src/pages/Voting.tsx`
- Modify: `packages/web/src/pages/Documents.tsx`
- Modify: `packages/web/src/pages/Graveyard.tsx`
- Modify: `packages/web/src/pages/Favours.tsx`

- [ ] **Step 1: Update each `<DataTable emptyMessage={...}>` and any inline empty fallbacks**

Apply these replacements (search for the existing prop in each file):

- `Bills.tsx`: `emptyMessage="The legislature has yet to introduce a bill in this filter."`
- `Tickets.tsx`: `emptyMessage="Inbox is empty. The chamber rests."`
- `Voting.tsx`: `emptyMessage="No votes are scheduled."`
- `Documents.tsx`: `emptyMessage="No documents in this collection."`
- `Graveyard.tsx`: `emptyMessage="None have been laid to rest."`
- `Favours.tsx`: `emptyMessage="No exchanges of favour on record."`

If a file uses an inline empty render rather than `DataTable`'s prop, replace the inline message with the same string.

- [ ] **Step 2: Manual verify**

Apply filters to each page that produce empty results. Confirm copy reads correctly.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Bills.tsx packages/web/src/pages/Tickets.tsx packages/web/src/pages/Voting.tsx packages/web/src/pages/Documents.tsx packages/web/src/pages/Graveyard.tsx packages/web/src/pages/Favours.tsx
git commit -m "feat(web): bespoke empty-state copy across list pages"
```

---

## Task 7.5: Hover transition sweep

**Files:**
- Modify: `packages/web/src/main.css`

Per spec: confine to the existing `.card` class and DataTable rows. Add `transition-colors duration-150 ease-out` if missing. Do NOT change other elements.

- [ ] **Step 1: Read the existing `.card` class definition in `main.css`**

Run: `grep -A 8 '\.card' packages/web/src/main.css`

- [ ] **Step 2: Update `.card` to ensure consistent transitions**

If `.card` doesn't already include transition rules, add them. The existing class likely uses `@apply` directives — append `transition-colors duration-150 ease-out` to the apply chain. Example before/after:

Before:
```css
.card {
  @apply bg-card border border-border-subtle rounded-card p-4 border-l-2;
}
```

After:
```css
.card {
  @apply bg-card border border-border-subtle rounded-card p-4 border-l-2 transition-colors duration-150 ease-out;
}
```

(Adjust to whatever the existing apply chain actually contains — read first.)

- [ ] **Step 3: Read DataTable row rendering**

Run: `grep -n 'tr\|row' packages/web/src/components/shared/DataTable.tsx | head -10`

- [ ] **Step 4: Add hover transition to DataTable row class (only if missing)**

In `DataTable.tsx`, the row className typically includes `hover:bg-hover` or similar. If it doesn't already include `transition-colors`, append `transition-colors duration-150 ease-out` to the row className.

If the row already has `transition-colors`, no change needed — close this task.

- [ ] **Step 5: Manual verify**

Run `pnpm dev:web`. Hover over a Dashboard metric card and a row in any DataTable — confirm the color shift is smooth (~150ms), not abrupt.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/main.css packages/web/src/components/shared/DataTable.tsx
git commit -m "feat(web): consistent 150ms hover transitions on cards and table rows"
```

---

# Phase 8: End-to-end verification

## Task 8.1: Manual smoke test (staff and non-staff)

This is a checklist, not code. Execute each item in a real browser session.

- [ ] **Step 1: Restart everything fresh**

```bash
docker compose down
docker compose up -d
```

Wait for services to be healthy. `pnpm dev:bot` if testing Discord bot interactions; `pnpm dev:api` and `pnpm dev:web` for the webapp.

- [ ] **Step 2: Non-staff smoke**

In an incognito browser:

- Visit `http://localhost:5173/` → redirected to `/login`
- Login page renders with parchment design
- Click Sign in with Discord → complete OAuth → redirected to `/`
- Dashboard renders with real numbers and trend deltas
- Activity feed shows grouped sections OR the empty-state if no data
- Sidebar: Moderation entry NOT visible
- Visit `/moderation` directly: Forbidden page renders
- Visit `/simulation`: page renders, no action forms visible
- Visit `/favours`: own balance visible, grant/spend/remove forms hidden
- Visit a `/bills/<slug>`: enact/repeal/edit/etc. buttons hidden (unless you authored)
- UserMenu in sidebar footer shows your username; click → Sign out → land on `/login`

- [ ] **Step 3: Staff smoke**

In a separate window/profile:

- `psql` into the DB and `UPDATE players SET is_staff = true WHERE discord_username = '<your-staff-username>'`
- Log in fresh
- Sidebar: Moderation entry IS visible
- Visit `/moderation` → page renders with stats and active actions
- Click Warn → modal opens. Pick a player from typeahead. Reason. Submit. Action appears in list optimistically.
- Click Mute → modal opens. Pick a player. Pick 24h. Reason. Submit. Active mutes section gets a new entry.
- Click Suspend → modal opens. Pick a player. Pick Permanent. Reason. Submit.
- Visit `/simulation`: tick-advance form visible. Try advancing a tick → confirm sim_tick increments.
- Visit `/favours`: grant form visible.
- Visit a `/bills/<slug>`: enact/repeal buttons visible.

- [ ] **Step 4: Edge cases**

- Cancel an OAuth flow at the Discord prompt → redirected to `/login?error=access_denied` with friendly message
- Log in, then `DELETE FROM players WHERE id = '<your-player-uuid>'` while session is active. Refresh any page → 401 → redirected to `/login`
- Log in via two browser tabs simultaneously as a fresh Discord user (rare but the on-conflict path) → both end up at the dashboard with the same `players.id`

- [ ] **Step 5: Commit a "verified" marker (optional)**

```bash
git commit --allow-empty -m "verify: webapp build-out passes E2E smoke as staff and non-staff"
```

---

# Self-Review Checklist (run after writing this plan)

- [ ] Every spec section maps to at least one task
- [ ] No "TBD" / "TODO" / "fill in later" placeholders in the plan body
- [ ] Hooks are created before the components that consume them (Phase 5/6 confirms this with sub-step ordering; Task 7.2 is flagged as a pre-req for 2.5/2.6/5.3/6.3)
- [ ] Method/property names are consistent across tasks (`useAuth`, `findOrCreatePlayerByDiscordId`, `aggregatePermissionsForPlayer`, `useDashboardOverview`, `useDashboardActivity`, `useSearchPlayers`, `useCreateModAction`, `<PlayerAvatar>`, `<RouteGuard>`, `<ModActionModal>`)
- [ ] The OAuth error flow is consistent end-to-end (backend redirects to `/login?error=<code>`; Login.tsx reads `?error=` and shows a message)
- [ ] `session.user.id` is `players.id` (UUID) end-to-end after Phase 1
- [ ] `request.player` is required after Task 1.7; downstream tasks may rely on it
- [ ] Permission staleness (mid-session demotion) — accepted limitation per spec; not "fixed" in this plan
- [ ] Polish-sweep CSS values (`shadow-modal-warm`, `.rule`, `.bg-parchment`, `.parchment-frame`) match the spec's recommendations
- [ ] Manual verification steps (browser smoke, OAuth, DB checks) are concrete and runnable
- [ ] Commits are frequent and atomic — one conceptual change per commit
