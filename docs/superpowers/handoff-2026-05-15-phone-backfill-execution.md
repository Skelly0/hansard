# Handoff: execute the phone-log transcript backfill against prod

**Date written:** 2026-05-15, late evening UTC
**Previous session's branch:** `claude/telephone-registry-system-ysOn8` (merged via PR #22, plus follow-up PRs #23 and #24)
**What's left:** run the backfill script against prod to replay 17 recovered phone calls + 93 transcript messages into a per-pair private staff thread under Discord channel `1504812456042561587`.

## tl;dr

The entire phone-log backfill machinery has shipped to main. The Railway env var is set. The bot is online. **17 recovered phone calls and 93 transcript messages were just restored to prod Neon from a PITR branch.** All that remains is invoking the script:

```sh
# Inspect first (no writes):
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --dry-run

# Pilot one call to eyeball the resulting Discord thread:
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --limit 1

# Full sweep:
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --verbose
```

That's it. The script handles per-pair thread creation, ordered embed posting, staff pings, advisory locking, and idempotency. Discord rate-limit pacing is 1100 ms per thread (so a pair with 90 messages takes ~100 s of replay time).

## State of the system at handoff time

### Code on main
- PR #22 — backfill machinery (schema column, migration, script, refactored exports, test suite). MERGED.
- PR #23 — worker `Date`-param fix. MERGED.
- PR #24 — bot `postgres` dep hotfix. MERGED.

### Railway
- Bot service: ONLINE. Latest deploy commit: `19a940e` (PR #23 merge).
- `PHONE_LOG_CHANNEL_ID=1504812456042561587` set on the bot service.
- All three services (api/bot/web) point at the same Neon DB: `ep-divine-scene-ab56u6uk.eu-west-2.aws.neon.tech/neondb`. No staging env.

### Production DB state
```
phone_numbers:  19   (preserved; never lost)
phone_threads:  0    (NEVER existed pre-backfill — PHONE_LOG_CHANNEL_ID was unset)
phone_calls:    17   (RESTORED from PITR branch via TRASH/scripts-tmp/recover-phones.mjs)
phone_messages: 93   (RESTORED — sequence_no advanced to 94 to prevent collisions)
```

All 17 restored calls have `backfilled_at IS NULL` (because the recovery branch predates the migration). They are eligible for backfill.

### What the backfill will actually do
- For each of the 17 calls (ordered by `started_at` ASC):
  1. Resolve `getCallParticipants(callId)` (caller name, recipient name, both numbers).
  2. Create (or reuse) a per-pair private Discord thread under `PHONE_LOG_CHANNEL_ID`.
  3. First-call-per-pair: ping the staff role + background-add staff members to the thread.
  4. Write `phone_calls.staff_thread_id = <new thread id>`.
  5. Post embeds, paced ≥1100 ms apart per thread:
     - "Call connected (backfilled)" with caller/recipient/numbers + `setTimestamp(call.startedAt)`.
     - One embed per `phone_messages` row in `(createdAt, sequenceNo)` order, with `backfilled • <ISO timestamp>` footer.
     - "Call ended" with `formatPhoneEndedReason(endedReason)` + `setTimestamp(call.endedAt)`.
  6. Write `phone_calls.backfilled_at = NOW()` only after the ended embed posts.
- Hard invariant: NEVER writes to `phone_messages.{recipient,staff_mirror,sender}_discord_message_id`. Those columns belong to the live relay. A crash-rerun must not overwrite them.

## Pre-flight checklist

Before running the full sweep:

- [ ] Verify the bot is actually online: `railway logs --service bot 2>&1 | tail -20` should show "Registered N guild commands" and not crash output.
- [ ] Verify the bot has the right perms in `<#1504812456042561587>`: ViewChannel + SendMessages + CreatePrivateThreads + SendMessagesInThreads. The script's `preflight()` checks this and aborts cleanly if missing.
- [ ] Pick a low-traffic window for the full sweep (the script has accepted-constraint live-traffic interleave behavior — if a real call lands on a pair during replay, embeds interleave in the staff thread by Discord receive order, not chronologically; the `setTimestamp` lets staff visually reorder).

## Commands, in order

### 1. Dry-run (safe, read-only)

```sh
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --dry-run
```

Expected output (approximate):
```
Found 17 calls needing backfill across N pairs.
Would post (17 + 93 + 17) = 127 embeds across N threads.
Estimated runtime: ~3 minutes.
```

If counts look wildly off (e.g., 0 calls), stop and check `pg_stat_user_tables` and the recovery state.

### 2. Pilot — one call

```sh
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --limit 1
```

After this:
- Open the new Discord thread under `<#1504812456042561587>`.
- Confirm:
  - "Call connected (backfilled)" embed with the right caller/recipient names + numbers.
  - Original timestamp shown via `setTimestamp` (the relative-time chip on the embed).
  - Footer reads `backfilled • <ISO>`.
  - Transcript embeds in chronological order.
  - "Call ended" embed at the bottom.
  - Staff role got pinged exactly once.
  - The `phone_calls` row for this call now has `staff_thread_id` set AND `backfilled_at` set.

If anything looks wrong, **stop**. The next sweep will pick up where this left off because `backfilled_at IS NULL` is the skip filter.

### 3. Full sweep

```sh
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --verbose
```

`--verbose` logs every 50 sends so you can track progress. ~16 remaining calls + ~93 messages → ~120 sends → ~3 minutes at 1100 ms per thread (with some parallelism across distinct pairs).

After completion, this query should return 0:
```sql
SELECT COUNT(*) FROM phone_calls WHERE backfilled_at IS NULL AND status NOT IN ('ringing','active');
```

## Known gotchas

### Railway API flakiness
At handoff time, `railway run` was intermittently returning:
```
Failed to fetch: error decoding response body
Caused by: error decoding response body
```
Just retry. Two minutes later it worked fine. If the script hangs with zero output, kill it and retry.

### Test infrastructure hard rule (LEARNED THE HARD WAY)
**Integration tests must gate on `TEST_DATABASE_URL` only — NEVER fall back to `DATABASE_URL`.** Earlier this session, the backfill test suite had `TEST_DATABASE_URL ?? DATABASE_URL` and its `clearPhoneTables()` `beforeEach` deleted 105 real user phone messages + 17 call rows from prod Neon. **The data is now restored from a PITR branch**, but the fix was hardened on main in commit `71fe542`. Documented in CLAUDE.md's Testing section + memory entry `feedback_integration_test_db_isolation.md`. **DO NOT WEAKEN OR REVERT THIS GATE.**

### Windows path gotchas
- The script's auto-run gate uses `pathToFileURL(process.argv[1]).href === import.meta.url` instead of the naive template-string compare. Don't revert.
- `.env` reads are blocked by env-safe filter. Use `Select-String -Path .env -Pattern '^KEY='` to detect a key without dumping contents. PowerShell only.

### Discord rate limit
The script paces ≥1100 ms per `thread.id`. **Different threads pace independently** (different rate buckets). But because the outer loop is serial, at most one send is in flight at any moment. So even with N distinct pairs the realistic throughput cap is ~1 send/sec global. Don't try to parallelize — Discord's 5/5s per-channel limit and the bot's other workloads make serial-with-pacing the safe path.

### `phone_threads.discord_thread_id` is `varchar(20)`
Discord snowflakes are 17-19 digits. Don't prepend or transform; pass raw.

### Neon recovery branch (cleanup)
The user created a Neon branch named `recovery-phone-2026-05-15` rooted at 2026-05-15 15:00 UTC. After the backfill is verified done and the data is no longer needed for any follow-up, **the user should delete the recovery branch** from the Neon console to free storage.

## Files of interest

- Script: `packages/bot/scripts/backfillPhoneThreads.ts`
- Tests: `packages/bot/scripts/backfillPhoneThreads.test.ts` (15 cases, gated on `TEST_DATABASE_URL`)
- Migration: `packages/db/scripts/migrate-phone-backfill-marker.ts` (already applied — `--validate` confirms)
- Drizzle schema: `packages/db/src/schema/phones.ts` (column `backfilledAt` on `phoneCalls`)
- Spec: `docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md`
- Plan: `docs/superpowers/plans/2026-05-15-phone-log-backfill.md`
- Recovery script (used once, kept for reference): `TRASH/scripts-tmp/recover-phones.mjs`

## Memory entries to read first

- `MEMORY.md` index
- `feedback_integration_test_db_isolation.md` — the rule about TEST_DATABASE_URL gating

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Script exits with "Bot is missing X in <#...>" | Missing CreatePrivateThreads/SendMessagesInThreads on the bot in `1504812456042561587` | Grant perms via Discord channel settings; rerun |
| Script exits with "Another backfill is in progress" | `pg_advisory_lock(1504812456)` held — likely a stale process or concurrent run | `SELECT pg_advisory_unlock(1504812456);` against prod (or wait for the other run to finish) |
| Embeds show "Unknown" for caller/recipient | Player rows missing; `phone_calls` references a player that was deleted | Skip those calls manually (set `backfilled_at = NOW()`) or investigate the missing player |
| Discord 429 errors in logs | Pacing isn't keeping up | Already self-heals via discord.js backoff. Just slower. |
| Bot offline during backfill | Crash or redeploy | Rerun from the same command; idempotent on `backfilled_at IS NULL` |

## Definition of done

- Dry-run reports 0 eligible calls (`Found 0 calls needing backfill...`).
- `SELECT COUNT(*) FROM phone_calls WHERE backfilled_at IS NULL AND status NOT IN ('ringing','active')` returns 0.
- All 17 recovered calls are visible as embeds in per-pair private threads under `<#1504812456042561587>`.
- Optional: delete the `recovery-phone-2026-05-15` Neon branch.

Good luck. The hard part is done; this is just pressing play.
