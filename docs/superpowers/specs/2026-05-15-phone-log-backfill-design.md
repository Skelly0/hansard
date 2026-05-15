# Phone log channel rollout + backfill

**Date:** 2026-05-15 (r3 — finalized after two code-review passes)
**Status:** Spec — final, awaiting user approval before implementation
**Owner:** skelly9912

## Problem

`PHONE_LOG_CHANNEL_ID` has been unset in the bot deployment, so calls placed up to now have:

- `phone_calls.staff_thread_id IS NULL`
- Zero rows in `phone_threads`
- A complete `phone_messages` ledger nonetheless (the relay always persists, even when no staff mirror exists)

Staff need an oversight thread for every call. We're designating Discord channel `1504812456042561587` as the new `PHONE_LOG_CHANNEL_ID` and replaying historic call transcripts into per-pair private threads beneath it.

## Goals

- Make `PHONE_LOG_CHANNEL_ID=1504812456042561587` the active value in both local dev and production.
- For every historic call without a staff thread, create the appropriate per-pair private thread under the new channel and post a faithful, chronological transcript replay.
- Make the backfill idempotent, resumable, dry-runnable, and rate-limit-safe per Discord's actual per-thread limit.
- Use `phone_calls.staff_thread_id` as the "thread exists" pointer (set immediately on thread resolution, matching live-relay semantics) and a new `phone_calls.backfilled_at` column as the "transcript fully replayed" idempotency marker.

## Non-goals

- Migrating threads from any previously-configured `PHONE_LOG_CHANNEL_ID`. (Answered: there isn't one.)
- Replaying live calls (`status IN ('ringing', 'active')`). Those belong to the live relay; touching them would race with `recordMessage`.
- Re-running tap fan-out for historic messages. Taps are forward-looking surveillance, not a retroactive feed. Backfilled embeds go to the staff thread only — the script reads `getCallTranscript`'s `messages` field and explicitly ignores its `taps` field.
- Writing to `phone_messages.recipient_discord_message_id`, `phone_messages.staff_mirror_message_id`, or `phone_messages.sender_discord_message_id`. **Those columns reflect the live relay only.** Backfilled embeds exist solely in Discord; the persisted ledger row remains the unchanged source of truth. A future contributor must not "helpfully" write the backfilled embed ids back onto the row — a crash-and-rerun cycle would then overwrite the originals with duplicate ids and lose the audit pointer.
- Adding a periodic / scheduled backfill. This is a one-shot.
- Locking out live phone traffic for the duration of the backfill. (See **Live-traffic interleave** below.)

## Rollout: setting the env var

### Local `.env`

Append/upsert `PHONE_LOG_CHANNEL_ID=1504812456042561587` in the root `.env`. Because Read on `.env` is blocked, the upsert runs in PowerShell:

1. `Select-String -Path .env -Pattern '^PHONE_LOG_CHANNEL_ID='` — emits only the matching line (no full-file dump).
2. If a match exists, rewrite the file by `Get-Content` → `-replace '^PHONE_LOG_CHANNEL_ID=.*', 'PHONE_LOG_CHANNEL_ID=1504812456042561587'` → `Set-Content`.
3. If no match, single `Add-Content` of `PHONE_LOG_CHANNEL_ID=1504812456042561587` to the end of `.env`.

The PowerShell pipeline only reads the file to perform the replace; we never display its contents.

### Railway

```sh
railway service list                     # confirm the bot service name
railway variables --service bot --set PHONE_LOG_CHANNEL_ID=1504812456042561587
```

Railway's auto-deploy redeploys the bot service.

### Local restart

`tsx watch` does not re-read `.env` on change. If a local bot is running, the operator restarts it.

## Schema change

A small schema addition is required to make the backfill resumable without dup-posting.

### New column

`phone_calls.backfilled_at TIMESTAMPTZ NULL` — `NULL` for never-backfilled or in-flight; `NOW()` when the transcript replay completes successfully.

### Drizzle schema delta

`packages/db/src/schema/phones.ts` adds:

```ts
backfilledAt: timestamp('backfilled_at', { withTimezone: true, mode: 'date' }),
```

### Migration

`packages/db/scripts/migrate-phone-backfill-marker.ts` mirrors `migrate-phones.ts` in shape:

- Wrapped in a single `sql.begin(...)` transaction.
- `ALTER TABLE phone_calls ADD COLUMN IF NOT EXISTS backfilled_at TIMESTAMPTZ NULL;`
- Supports `--dry-run` (prints the SQL without executing) and `--validate` (asserts the column exists post-migration), matching the flag set on `migrate-phones.ts`.
- No index needed (single scan against `staff_thread_id IS NULL` / `backfilled_at IS NULL` once).
- pnpm wiring: `"migrate:phone-backfill-marker": "tsx scripts/migrate-phone-backfill-marker.ts"` in `packages/db/package.json`.
- Must run before `pnpm --filter @hansard/bot backfill:phone-threads`.

### Migration test

`packages/db/scripts/migrate-phone-backfill-marker.test.ts` follows the `migrate-phones.test.ts` string-grep style (the existing `packages/db` test convention — no full Vitest schema-introspection runner). Asserts the migration script source text contains:

- A `sql.begin(...)` wrapper.
- `ADD COLUMN IF NOT EXISTS backfilled_at`.
- The column type `TIMESTAMPTZ` (not `TIMESTAMP WITHOUT TIME ZONE`) and is nullable (no `NOT NULL`).
- A `--dry-run` flag handler.
- A `--validate` flag handler that queries `information_schema.columns` for the new column.

This places the schema check inside the migration test file rather than spinning up a fresh Vitest suite under `packages/db`.

## Backfill script

### Location and invocation

- File: `packages/bot/scripts/backfillPhoneThreads.ts`
- pnpm wiring (`packages/bot/package.json`): `"backfill:phone-threads": "tsx scripts/backfillPhoneThreads.ts"`
- Invocation: `pnpm --filter @hansard/bot backfill:phone-threads [--dry-run] [--limit N] [--verbose]`
- Mirrors the existing `close:due-votes` script shape.

### Discord client config

- **Intents:** `GatewayIntentBits.Guilds | GatewayIntentBits.GuildMembers`. `GuildMembers` is privileged but already enabled on the live bot; required for `backgroundStaffAdd` to populate the member cache.
- **Partials:** none.
- Startup warning: after the first `guild.members.fetch()` call, if `guild.members.cache.size <= 1`, log `Warning: GuildMembers intent appears disabled — staff will not be auto-added to backfilled threads.`
- Graceful shutdown on SIGINT/SIGTERM: finish the current call's in-flight sends, then `client.destroy()` and release the advisory lock.

### Exported helpers

`packages/bot/src/utils/phoneRelay.ts` currently keeps `sendStaffJoinPing` and `backgroundStaffAdd` as module-private functions. This spec exports both as part of the implementation PR so the backfill script can `import { sendStaffJoinPing, backgroundStaffAdd } from '../src/utils/phoneRelay.js'` and use the exact live behavior. Duplicating them inline in the script would create a drift hazard.

The export change is purely additive — no callers change — so it does not affect the live relay's behavior.

### Pipeline (per call, ordered by `started_at` ASC)

```
acquire pg_advisory_lock(BACKFILL_LOCK_KEY) — bail if held
preflight: fetch PHONE_LOG_CHANNEL_ID, verify perms
  Required perms in the channel:
    - ViewChannel
    - SendMessages
    - CreatePrivateThreads
    - SendMessagesInThreads

load every phone_calls row where:
  backfilled_at IS NULL
  AND status NOT IN ('ringing', 'active')
  ORDER BY started_at ASC

for each call:
  participants = PhoneService.getCallParticipants(callId)
  thread, didCreateThread = ensureBackfillThread(client, participants)
    # findOrCreateThread inherits the same onOrphan hook used by the live relay
    # — see "Reused primitives" below
  if didCreateThread:
    await sendStaffJoinPing(thread, guild, callerName, recipientName)
    void backgroundStaffAdd(thread, guild, staffRoleIds)
  PhoneService.setStaffThread(callId, thread.id)
    # write thread pointer immediately so live calls on this pair reuse it
  post "Call connected (backfilled)" embed
  for message in getCallTranscript(callId, syntheticStaffViewer).messages:
    post message embed
    await perThreadPace(thread.id)            # ≥1100ms gap per thread
  post "Call ended" embed
  update phone_calls SET backfilled_at = NOW() WHERE id = callId

release pg_advisory_lock
client.destroy()
```

The `didCreateThread` boolean is the single first-call-per-pair gate: both `sendStaffJoinPing` AND `backgroundStaffAdd` fire only when a brand-new `phone_threads` row was created during this call's iteration. Subsequent calls for the same pair (whether discovered later in the same run or already persisted from a live call) reuse the thread without re-pinging staff or re-fetching the full guild member list.

The synthetic staff viewer:

```ts
// userId is unused for the staff branch of getCallTranscript (phoneService.ts:getCallTranscript
// short-circuits on isStaff = true), but we use the nil UUID so the script can never collide
// with a real player row if a future branch in that method starts reading userId for staff.
const SYNTHETIC_BACKFILL_VIEWER: PhoneViewer = {
  userId: '00000000-0000-0000-0000-000000000000',
  isStaff: true,
};
```

The script reads only `transcript.messages`. The `transcript.taps` field is documented as ignored in Non-goals and asserted in a unit test.

### Idempotency contract

Two markers, two roles:

| Field | Set when | Meaning |
|---|---|---|
| `phone_calls.staff_thread_id` | Immediately on thread resolution | "A staff thread exists for this call's pair." Identical semantics to the live relay's first message. Live calls on the same pair will discover and reuse this thread. |
| `phone_calls.backfilled_at` | After "Call ended" embed posts | "This call's historic transcript was fully replayed." The skip-filter on rerun. |

Mid-call crash leaves `staff_thread_id IS NOT NULL` and `backfilled_at IS NULL`. The rerun re-replays that call's transcript end-to-end. That produces **at most one duplicate transcript block for the single crashed call**, never more, regardless of how many later calls were queued. The runbook calls this out.

**Crucially, the per-message embed-post loop must NEVER write to `phone_messages.recipient_discord_message_id`, `phone_messages.staff_mirror_message_id`, or `phone_messages.sender_discord_message_id`.** Those columns reflect the live relay's send results. A rerun-after-crash would otherwise overwrite the originals with the duplicate's ids, destroying the audit trail. The unit test `crash recovery` asserts these columns remain unchanged.

The cross-process `pg_advisory_lock` ensures only one operator runs the script at a time. Acquisition failure aborts with `Another backfill is in progress.`

### Live-traffic interleave (accepted constraint)

If a live phone call lands on a pair while the backfill is replaying that pair's transcript, the live messages will interleave with the historic embeds in the staff thread. Backfilled embeds carry a `backfilled • <originalTimestamp>` footer **as plain text** (footers don't render Discord `<t:>` time tokens) and have their `setTimestamp(originalDate)` set, so the embed's relative-time chip displays correctly. Staff can reconstruct chronological order visually using the `setTimestamp` chip.

The operator runbook directs running the backfill during low-traffic hours to minimize the chance of interleave. A proper temporal lock would require modifying `phoneRelay.relayMessage` to acquire the same `pg_advisory_xact_lock` per pair during message recording — out of scope.

### Reused primitives

The script must reuse existing `PhoneService` primitives — it is NOT permitted to inline new SQL for these:

| Need | Reused primitive |
|---|---|
| Per-pair thread create with race-safe persist | `PhoneService.findOrCreateThread(playerA, playerB, { createThread, onOrphan })` |
| Marking a call's thread pointer | `PhoneService.setStaffThread(callId, threadId)` |
| Loading caller/recipient/numbers/players | `PhoneService.getCallParticipants(callId)` |
| Listing transcript rows | `PhoneService.getCallTranscript(callId, syntheticStaffViewer)` — read `messages`, ignore `taps` |
| Embed shapes | Copy structure from `postToStaffThread` and `hangUpAndNotify` in `phoneRelay.ts`, parameterized to accept the original timestamp. |
| Staff role ping + add | `sendStaffJoinPing` and `backgroundStaffAdd` from `phoneRelay.ts` (exported as part of this change). |

The script's `createThread` callback for `findOrCreateThread` MUST also pass through the live relay's `onOrphan` hook (which deletes the just-created Discord thread on a lost persist race). This is dead code under normal operation (the advisory lock ensures single-operator), but defense-in-depth against a future race condition. The simplest path: factor the `createThread + onOrphan` pair into a small shared helper exported from `phoneRelay.ts` and used by both `ensurePhoneThread` (live) and `ensureBackfillThread` (script).

Marking `backfilled_at` is a new operation specific to this script — implement as a thin `markBackfilled(callId)` helper in the script file (single `UPDATE phone_calls SET backfilled_at = NOW() WHERE id = ?`). No new exported `PhoneService` method needed.

### Filtering rules

| Call status | Backfilled? |
|---|---|
| `ended` | ✅ Full replay |
| `declined` | ✅ Connected + ended embed only (no messages exist) |
| `missed` | ✅ Connected + ended embed only |
| `cancelled` | ✅ Connected + ended embed only |
| `ringing` | ❌ Live — leave for relay |
| `active` | ❌ Live — leave for relay |

No date cutoff. Full one-time replay.

### Per-thread pacing

Discord's per-channel rate limit is 5 messages / 5 seconds (~1 msg/sec sustained), **separate from** the 50/sec global limit. A long replay into a single thread will trip the per-channel limit without pacing; discord.js auto-retries with backoff but it's slow and noisy.

The script maintains an in-memory `Map<threadId, lastSendAt>` and awaits a `setTimeout` so each per-thread send is ≥1100 ms after the previous send to that same thread. The outer loop is serial (`for ... await`), so at any moment exactly one send is in flight — cross-thread "parallelism" is nominal, not real. The per-thread `Map` matters in exactly one realistic case: pair-sharing, where the same thread reappears on a later call and the pacing prevents back-to-back hits on the same thread's bucket. Different threads are paced in isolation because they have independent rate-limit buckets.

Realistic throughput: ~50 messages/minute per thread. A pair with 200 historic messages takes ~4 minutes for its transcript section.

### Embed shapes

In all three, `setTimestamp(originalDate)` is what surfaces the original time in the embed's top-right chip. Footers are plain text — Discord's `<t:unix:f>` time-format tokens are NOT parsed inside `setFooter` content. The footer text is therefore the original timestamp as an ISO 8601 string.

**Call connected (backfilled):**

```
Title: 📞 Call connected
Color: STAFF_PALETTE (0x788c5d)
Fields:
  - Caller    { callerCharacterName } ({ callerNumber.numberRaw })
  - Recipient { recipientCharacterName } ({ recipientNumber.numberRaw })
Footer: backfilled • <call.startedAt.toISOString()>
setTimestamp: call.startedAt
```

**Message (per phone_messages row):**

```
Color: CALL_COLOR (0x9b7cb8)
Author: { senderCharacterName } ({ senderNumber.numberRaw })
       (or "[i/n]" suffix when content chunked > 4000 chars via chunkForEmbed)
Description: chunk via chunkForEmbed (existing helper)
Footer: to { recipientCharacterName } • backfilled • <message.createdAt.toISOString()>
setTimestamp: message.createdAt
allowedMentions: { parse: [] }
```

**Call ended:**

```
Title: ☎ Call ended
Color: ENDED_PALETTE (0x9c9890)
Description: formatPhoneEndedReason(endedReason) from @hansard/shared
Footer: backfilled • <call.endedAt.toISOString()>
setTimestamp: call.endedAt
```

### Pair-sharing semantics

When call N+1 in the iteration shares the unordered player pair with a call already processed in this run, `findOrCreateThread` returns the existing `phone_threads` row and we append to that thread. The script holds an in-memory `Map<pairKey, ThreadChannel>` cache to avoid re-fetching the thread each time.

A `phone_threads` row may also already exist from prior live calls. In that case `findOrCreateThread` likewise returns it and the script appends without re-pinging staff.

### Snowflake handling

All Discord IDs (thread, message, channel) flow through the script as raw snowflake strings — no formatting, no trimming, no prefixing. `phone_calls.staff_thread_id` is `varchar(20)` and silently truncates if anything is prepended. Test asserts the persisted `staff_thread_id` exactly equals the Discord-returned `thread.id`.

### Dry-run mode

`--dry-run`:

- Skips Discord login (no token consumed).
- Attempts `pg_try_advisory_lock(BACKFILL_LOCK_KEY)` non-blockingly. If unavailable (a real backfill is running), prints `Warning: real backfill in progress; counts may shift mid-query.` and continues without holding the lock.
- Reports counts: total calls, calls needing backfill (after `backfilled_at IS NULL` filter), estimated message-embed count, distinct pairs, estimated runtime (using the corrected ~50 msg/min-per-thread figure for the worst-pair).
- Does NOT write Discord or any DB column.
- Example output:
  ```
  Found 23 calls needing backfill across 11 pairs.
  Would post 52 embeds (1 connected + 47 messages + 4 ended across 11 threads).
  Worst-pair estimate: 5 calls × avg 12 messages = 78 sends @ 1.1s = ~86s.
  Total estimated runtime: ~4 minutes.
  ```

### `--limit N`

Smoke-test mode: stop after backfilling N calls. Lets the operator inspect one or two threads before unleashing the full sweep. The advisory lock IS acquired (so concurrent runs are blocked even in limit mode).

## Testing

### Migration test (`packages/db/scripts/migrate-phone-backfill-marker.test.ts`)

Follows the `migrate-phones.test.ts` string-grep convention:

- Asserts source contains a `sql.begin(...)` wrapper.
- Asserts source contains `ADD COLUMN IF NOT EXISTS backfilled_at`.
- Asserts source contains `TIMESTAMPTZ` and does NOT contain `NOT NULL` adjacent to the new column.
- Asserts source contains a `--dry-run` flag handler.
- Asserts source contains a `--validate` flag handler.

### Unit tests (`packages/bot/scripts/backfillPhoneThreads.test.ts`)

Vitest with a mock `discord.js` Client (stubbed `channels.fetch`, `thread.send`, `thread.members.add`, `client.users.fetch`, `guild.members.fetch`, `channel.permissionsFor`) against a Vitest-seeded DB.

| # | Case | Asserts |
|---|---|---|
| 1 | **Clean call** — one ended call, three messages. | One thread created, 5 embeds posted (connected + 3 messages + ended), `staff_thread_id` set immediately after thread resolution, `backfilled_at` set after ended embed. |
| 2 | **Zero-message call** — declined call, no messages. | Connected + ended embeds only, both markers set. |
| 3 | **Pair sharing (both fresh)** — two ended calls between same pair, neither pre-backfilled. | One thread, both calls' embed blocks present in chronological order, ping fires exactly once. |
| 4 | **Pair sharing with one pre-backfilled call** — call A already has `backfilled_at`, call B is fresh, same pair. | Call B reuses the existing `phone_threads` row + `staff_thread_id`, no re-ping. Cache-from-DB path exercised. |
| 5 | **Pair sharing with a live call** — pair P has an `active` call (`phone_threads` row exists from the live relay) and a historic `ended` call. | Historic call finds and reuses the existing thread, no re-ping. This is the most likely real-world configuration. |
| 6 | **Already backfilled** — call with `backfilled_at` set. | Skipped, no Discord sends. |
| 7 | **Idempotency** — run twice over the same seed. | Second run is a no-op end-to-end. |
| 8 | **Crash recovery** — call with `staff_thread_id` set but `backfilled_at` NULL (simulating mid-call crash). | Rerun re-replays this call's transcript end-to-end, sets `backfilled_at`. **Asserts `phone_messages.*_mirror_message_id` columns remain unchanged.** |
| 9 | **Live call skipped** — `status='active'`. | No Discord sends. |
| 10 | **`--limit N`** — 5 callbackfill-eligible, `--limit 2`. | First 2 backfilled (`backfilled_at` set); remaining 3 untouched (`backfilled_at` still NULL); advisory lock was held during the run. |
| 11 | **Dry-run** — `--dry-run` flag. | No Discord sends, no DB column writes, exit code 0, output contains "Would post". |
| 12 | **Dry-run with lock held** — `pg_try_advisory_lock` returns false. | Warning printed, exit code 0, counts still printed. |
| 13 | **Tap field ignored** — `getCallTranscript` returns messages + taps. | No Discord sends correspond to tap-derived data; embed sends match `messages.length`. |
| 14 | **Per-thread pacing** — two messages in the same thread back-to-back. | ≥1100ms gap between sends to that thread (mock timers / fake clock). |
| 15 | **Preflight permission failure** — channel exists but bot lacks `CreatePrivateThreads`. | Script aborts before any DB writes with a clear error. |

### Manual verification

1. Run `pnpm --filter @hansard/db migrate:phone-backfill-marker --dry-run` to inspect SQL, then without the flag to apply against local DB. Verify the column exists via `migrate:phone-backfill-marker --validate`.
2. Set `PHONE_LOG_CHANNEL_ID` locally, restart bot.
3. `pnpm --filter @hansard/bot backfill:phone-threads --dry-run` — verify counts.
4. `pnpm --filter @hansard/bot backfill:phone-threads --limit 1` — eyeball one thread.
5. Verify thread reuse — pick a pair-shared `--limit 2`.
6. Full sweep against prod after the migration is rolled out there: `pnpm --filter @hansard/bot backfill:phone-threads --verbose`.

## Failure modes + mitigations

| Failure | Mitigation |
|---|---|
| Discord per-channel rate limit hit | 1100ms per-thread pacing; discord.js auto-retries `429` with backoff as a fallback. |
| Discord global rate limit hit | Serial outer loop caps real concurrency at 1 send in flight; global limit unreachable in practice. |
| Bot lacks required perms in the new log channel | Preflight checks `ViewChannel + SendMessages + CreatePrivateThreads + SendMessagesInThreads`; aborts with a clear "bot needs X in #channel-name" message before any DB writes. |
| Bot lacks `GuildMembers` intent | Script explicitly enables it. If still disabled at runtime (e.g., bot config drift), startup warning logs and `backgroundStaffAdd` no-ops. Script completes; staff must be added manually. |
| Concurrent backfill run | `pg_advisory_lock` ensures only one runs at a time. Second invocation aborts loudly. |
| Process killed mid-call | Crashed call has `staff_thread_id` set, `backfilled_at NULL`, and zero writes to `phone_messages.*_mirror_message_id`. Rerun re-replays that one call's transcript end-to-end. Runbook says: "If you see two transcript blocks for the same call between two 'Call connected (backfilled)' embeds without a 'Call ended' in between, delete the older block." |
| DB connection drops | tsx + drizzle bubbles up; script exits non-zero. Operator reruns; lock cleanup is automatic on session close. |
| One call's player no longer exists | `getCallParticipants` throws on missing FKs. Catch + log + skip that call. Players are soft-deleted (`isAlive=false`), not hard-deleted, so unreachable in practice. |
| `PHONE_LOG_CHANNEL_ID` unset at script-start | Bail early with `process.exit(1)` and a clear message. |
| Live call on the same pair during replay | Documented as accepted operational constraint; embed `setTimestamp` allows visual reordering. Run during quiet hours. |

## Operator runbook

```sh
# 0. Roll out the schema column.
pnpm --filter @hansard/db migrate:phone-backfill-marker --dry-run   # inspect SQL
pnpm --filter @hansard/db migrate:phone-backfill-marker             # apply
pnpm --filter @hansard/db migrate:phone-backfill-marker --validate  # confirm

# 1. Make sure local env has the new channel id and bot is restarted.
pnpm --filter @hansard/bot backfill:phone-threads --dry-run
# Read the counts. If they look wrong, stop and investigate.

# 2. Pilot run.
pnpm --filter @hansard/bot backfill:phone-threads --limit 1
# Open Discord. Verify the thread looks correct.

# 3. Full sweep.
pnpm --filter @hansard/bot backfill:phone-threads --verbose
# Run during low phone-traffic hours to minimize live/historic interleave.
# If you see two transcript blocks for the same call (back-to-back "Call connected
# (backfilled)" embeds without a "Call ended" in between), the earlier was a crashed
# partial — delete that earlier block.
```

## Open questions

None.

## Out-of-scope follow-ups

- A `--since YYYY-MM-DD` flag if a future operator wants a partial replay.
- A web-side ops button to trigger the backfill.
- Backfilling tap deliveries.
- A temporal lock between live `relayMessage` and backfill replay on the same pair — would require touching the live relay's hot path.

## Changelog

- **2026-05-15 r1** — initial draft.
- **2026-05-15 r2** — code-review revisions: added `phone_calls.backfilled_at`, split marker semantics, `GuildMembers` intent, synthetic staff viewer + tap ignore, per-thread pacing, preflight perms, dry-run lock, snowflake pass-through, live-traffic interleave constraint.
- **2026-05-15 r3** — second-pass review revisions:
  - Idempotency contract now explicitly forbids writing `phone_messages.*_mirror_message_id` from the backfill.
  - Parallelism claim softened — outer loop is serial; per-thread pacing matters chiefly for pair-sharing.
  - Schema test rolled into the migration test file (string-grep style), no new `packages/db` Vitest suite.
  - First-call-per-pair gate explicit for both `sendStaffJoinPing` AND `backgroundStaffAdd`.
  - Migration script gains `--dry-run` and `--validate` flags; test asserts both.
  - Footer text is now ISO 8601, not `<t:unix:f>` (footers don't render time tokens). `setTimestamp` carries the relative-time chip.
  - `sendStaffJoinPing` + `backgroundStaffAdd` will be exported from `phoneRelay.ts` as part of this PR.
  - `onOrphan` hook explicitly inherited via a shared `createThread + onOrphan` helper.
  - Synthetic viewer uses nil UUID with an explanatory comment.
  - Test plan expanded to 15 cases: added pair-sharing with one-pre-backfilled, pair-sharing with a live call, `--limit N`. Crash-recovery test now asserts `phone_messages.*_mirror_message_id` columns remain unchanged.
