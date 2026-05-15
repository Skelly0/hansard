# Phone log channel rollout + backfill

**Date:** 2026-05-15
**Status:** Spec — awaiting user review
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
- Make the backfill idempotent, resumable, dry-runnable, and rate-limit-safe.
- No schema changes. No new persistence semantics. Reuse `phone_calls.staff_thread_id` as the "this call has a thread" marker, same as the live relay.

## Non-goals

- Migrating threads from any previously-configured `PHONE_LOG_CHANNEL_ID`. (Answered: there isn't one.)
- Replaying live calls (`status IN ('ringing', 'active')`). Those belong to the live relay; touching them would race with `recordMessage`.
- Re-running tap fan-out for historic messages. Taps are forward-looking surveillance, not a retroactive feed. Backfilled embeds go to the staff thread only.
- Adding a periodic / scheduled backfill. This is a one-shot. Future calls go through the live relay.

## Rollout: setting the env var

### Local `.env`

Append/upsert `PHONE_LOG_CHANNEL_ID=1504812456042561587` in the root `.env`. Because Read on `.env` is blocked, the upsert runs in PowerShell:

1. `Select-String -Path .env -Pattern '^PHONE_LOG_CHANNEL_ID='` — emits only the matching line (no full-file dump). If present:
2. Rewrite the file by `Get-Content` → replace the matching line → `Set-Content`. The whole pipeline reads via Select-String and rewrites without us seeing values — but to keep this clean, we'll use a more surgical approach: a one-line PowerShell script that builds the new content with `-replace` and writes only when the match exists, otherwise `Add-Content` an appended line.

If the key is absent: a single `Add-Content` of `PHONE_LOG_CHANNEL_ID=1504812456042561587` to the end of `.env`.

### Railway

```sh
railway service list                     # confirm the bot service name
railway variables --service bot --set PHONE_LOG_CHANNEL_ID=1504812456042561587
```

Railway's auto-deploy redeploys the bot service.

### Local restart

`tsx watch` does not re-read `.env` on change. If a local bot is running, the operator restarts it.

## Backfill script

### Location and invocation

- File: `packages/bot/scripts/backfillPhoneThreads.ts`
- pnpm wiring (`packages/bot/package.json`): `"backfill:phone-threads": "tsx scripts/backfillPhoneThreads.ts"`
- Invocation: `pnpm --filter @hansard/bot backfill:phone-threads [--dry-run] [--limit N] [--verbose]`
- Mirrors the existing `close:due-votes` script shape (same patterns for arg parsing, optional Discord render, graceful shutdown).

### Architecture

The script spins up a minimal `discord.js` Client (`GatewayIntentBits.Guilds` only — DMs / reactions not needed for backfill), logs in with `DISCORD_BOT_TOKEN`, runs the pipeline, then exits.

Top-level flow:

```
acquire pg_advisory_lock (BACKFILL_LOCK_KEY)
  load every phone_call where staff_thread_id IS NULL
    AND status NOT IN ('ringing', 'active')
    ORDER BY started_at ASC
  for each call:
    ensure thread (pair-keyed) under PHONE_LOG_CHANNEL_ID
    post "Call connected (backfilled)" embed
    stream phone_messages for the call (ORDER BY created_at, sequence_no)
      post each as a CALL_COLOR embed with backfill footer
    post "Call ended" embed (mirrors hangUpAndNotify)
    PhoneService.setStaffThread(callId, threadId)
release pg_advisory_lock
client.destroy()
```

### Reused primitives

The script must reuse existing `PhoneService` primitives — it is NOT permitted to inline new SQL for these:

| Need | Reused primitive |
|---|---|
| Per-pair thread reserve | `PhoneService.findOrReserveThread(playerA, playerB)` |
| Per-pair thread create with race-safe persist | `PhoneService.findOrCreateThread(playerA, playerB, { createThread, onOrphan })` |
| Marking a call as having a thread | `PhoneService.setStaffThread(callId, threadId)` |
| Loading caller/recipient/numbers/players | `PhoneService.getCallParticipants(callId)` |
| Listing transcript rows | `PhoneService.getCallTranscript(callId, staffViewer)` |
| Embed shapes | Copy the structure from `postToStaffThread` and `hangUpAndNotify` in `phoneRelay.ts`, parameterized to accept the original timestamp. |

If `getCallTranscript` proves too coupled to its `PhoneViewer` access rules for a script context, an alternative is a narrow new service method `listMessagesForBackfill(callId)` returning rows ordered by `(createdAt, sequenceNo)` — but the first attempt should go through the existing transcript path with a synthetic staff viewer.

### Idempotency contract

- A call with `staff_thread_id IS NOT NULL` is never touched. Step 1 of the loop skips it.
- `staff_thread_id` is written **after** the call's full transcript + ended embed have been posted. A mid-call crash leaves the call un-backfilled and a rerun retries it from scratch (which means up to one partial duplicate thread block could happen for the call that crashed — acceptable for a one-shot, and rare given the lock + bounded run time).
- Thread creation goes through `findOrCreateThread`, which already handles persist-race orphan cleanup via its `onOrphan` hook.
- A `pg_advisory_lock(BACKFILL_LOCK_KEY)` on a fixed app-defined key prevents two operators racing the script. If acquisition fails, the script aborts with a clear message: "Another backfill is in progress."

### Filtering rules

| Call status | Backfilled? |
|---|---|
| `ended` | ✅ Full replay |
| `declined` | ✅ Connected + ended embed only (no messages exist) |
| `missed` | ✅ Connected + ended embed only |
| `cancelled` | ✅ Connected + ended embed only |
| `ringing` | ❌ Live — leave for relay |
| `active` | ❌ Live — leave for relay |

No date cutoff. This is a full one-time replay.

### Embed shapes

**Call connected (backfilled):**

```
Title: 📞 Call connected
Color: STAFF_PALETTE (0x788c5d)
Fields:
  - Caller   { callerCharacterName } ({ callerNumber.numberRaw })
  - Recipient { recipientCharacterName } ({ recipientNumber.numberRaw })
Footer: backfilled • <original startedAt as Discord <t:unix:f>>
Timestamp: call.startedAt
```

**Message (per phone_messages row):**

```
Color: CALL_COLOR (0x9b7cb8)
Author: { senderCharacterName } ({ senderNumber.numberRaw })
       (or "[i/n]" suffix when content chunked > 4000 chars)
Description: chunk via chunkForEmbed (existing helper)
Footer: to { recipientCharacterName } • backfilled • <original createdAt as Discord <t:unix:f>>
Timestamp: message.createdAt
allowedMentions: { parse: [] }
```

**Call ended:**

```
Title: ☎ Call ended
Color: ENDED_PALETTE (0x9c9890)
Description: formatPhoneEndedReason(endedReason) from @hansard/shared
Footer: backfilled • <original endedAt as Discord <t:unix:f>>
Timestamp: call.endedAt
```

### Pair-sharing semantics

When call N+1 in the iteration shares the unordered player pair with a call already processed in this run, `findOrCreateThread` returns the existing `phone_threads` row and we append directly to that thread. The script holds an in-memory `Map<pairKey, ThreadChannel>` cache to avoid re-fetching the thread each time.

The first call for a pair triggers the standard `sendStaffJoinPing` + background `thread.members.add(...)` — same as live, code reused from `phoneRelay.ts` (extracted to a shared helper if needed, but a copy is fine for a one-shot script).

### Rate-limit pacing

- Hard pace: 150 ms `setTimeout` between Discord sends. At <7 sends/sec we're comfortably below Discord's 50 msg/s global cap with headroom.
- Per-thread sends are already serialized by the outer `for ... await` loop. No `Promise.all` over messages.
- Estimated runtime: 5000 historic messages ≈ 12.5 min. Acceptable for a one-shot. Verbose mode logs every 50 sends so operators see progress.

### Dry-run mode

`--dry-run`:

- Skips Discord login (no token consumed).
- Reports counts: total calls, calls to backfill, estimated message-embed count, distinct pairs, estimated runtime.
- Does NOT acquire the advisory lock. Pure read-only DB query.
- Output:
  ```
  Found 23 calls needing backfill across 11 pairs.
  Would post 1 + 47 + 1 = ... embeds (52 sends total).
  Estimated runtime: ~8s (at 150ms/send).
  ```

### `--limit N`

Smoke-test mode: stop after backfilling N calls. Lets the operator inspect one or two threads before unleashing the full sweep. The advisory lock is still acquired so concurrent runs don't race.

## Testing

### Unit tests (`packages/bot/scripts/backfillPhoneThreads.test.ts`)

Vitest with a mock `discord.js` Client (stubbed `channels.fetch`, `thread.send`, `thread.members.add`, `client.users.fetch`) against a Vitest-seeded DB containing:

1. **Clean call** — one ended call, three messages. Asserts: one thread created, 5 embeds posted (connected + 3 messages + ended), `staff_thread_id` set.
2. **Zero-message call** — declined call with no messages. Asserts: connected + ended embeds only, `staff_thread_id` set.
3. **Pair sharing** — two calls between the same player pair. Asserts: one thread, both calls' embed blocks present in chronological order.
4. **Already backfilled** — call with `staff_thread_id` set. Asserts: skipped, no Discord sends.
5. **Idempotency** — run twice over the same seed. Asserts: second run is a no-op.
6. **Live call** — `status='active'`. Asserts: skipped, no Discord sends.
7. **Dry-run** — `--dry-run` flag. Asserts: no Discord sends, no `staff_thread_id` writes, exit code 0, output contains "Would post".

### Manual verification

1. Set `PHONE_LOG_CHANNEL_ID` locally, restart bot.
2. `pnpm --filter @hansard/bot backfill:phone-threads --dry-run` — verify counts match expectations.
3. `pnpm --filter @hansard/bot backfill:phone-threads --limit 1` — pick one call, eyeball the resulting thread structure (connected + transcript + ended embeds, footer says "backfilled", staff role pinged once).
4. Inspect: thread reuse — does a second small `--limit` run on a pair-shared call append rather than create new?
5. Full sweep against prod: `pnpm --filter @hansard/bot backfill:phone-threads --verbose`.

## Failure modes + mitigations

| Failure | Mitigation |
|---|---|
| Discord rate limit hit | 150ms pacing + retry-after honored by discord.js; if a single send still 429s, log and continue (a 429-blocked embed is a missing audit entry but not a corruption). |
| Bot lacks ViewChannel/SendMessages in the new log channel | Fail fast at startup: fetch the channel, attempt a permission check via `channel.permissionsFor(client.user)`. Abort with a clear "bot needs Manage Threads + Send Messages in #channel-name" message. |
| Concurrent backfill run | `pg_advisory_lock` ensures only one runs at a time. Second invocation aborts loudly. |
| Process killed mid-run | Last in-flight call may have a partial thread block (no "Call ended" embed, `staff_thread_id` not set yet). Operator reruns; that call will get a fresh full block appended. Acceptable for a one-shot. |
| DB connection drops | tsx + drizzle bubbles up; script exits non-zero. Operator reruns; lock cleanup is automatic on session close. |
| One call's player no longer exists | `getCallParticipants` throws on missing FKs. Catch + log + skip that call. (Player rows are soft-deleted via `isAlive=false`, not hard-deleted, so this should be unreachable in practice — but defensive.) |
| `PHONE_LOG_CHANNEL_ID` unset at script-start | Bail early with `process.exit(1)` and a clear message. |

## Operator runbook

```sh
# 1. Make sure local env has the new channel id.
pnpm --filter @hansard/bot backfill:phone-threads --dry-run
# Read the counts. If they look wrong, stop and investigate.

# 2. Pilot run.
pnpm --filter @hansard/bot backfill:phone-threads --limit 1
# Open Discord. Verify the thread looks correct.

# 3. Full sweep.
pnpm --filter @hansard/bot backfill:phone-threads --verbose
```

## Open questions

None. Sub-questions raised at design-review:

- **Backfill missed/declined/cancelled?** Yes, with a connected + ended pair only (audit completeness).
- **Date cutoff?** No, full history.
- **Append to existing per-pair thread?** Yes, matches live semantics.

## Out-of-scope follow-ups

- A `--since YYYY-MM-DD` flag if a future operator wants a partial replay. Current spec doesn't need it.
- A web-side ops button to trigger the backfill. CLI is sufficient.
- Backfilling tap deliveries. Out of scope per Non-goals.
