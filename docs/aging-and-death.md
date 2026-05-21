# Aging & Death — How It Actually Works

A complete tour of the pipeline from sim clock → birth dates → tick rolls → graveyard.

---

## 1. The simulation clock

There's a single row in `simulation_clock` (schema: `packages/db/src/schema/simulation.ts`). It holds:

- **`currentDate`** — the in-sim "now". Either ISO (`1923-06-15`) or freeform (`Year 4, Month 3`).
- **`currentTick`** — monotonic counter (just an integer that grows).
- **`tickUnit`** — `'day' | 'week' | 'month' | 'year'`. How much each tick is worth; the schema default is `year`.
- **`startDate`** — where the season began. Reference only — math uses `currentDate`.
- **`agingConfig`** — JSONB, nullable. If `null`, falls back to `DEFAULT_AGING_CONFIG`.
- **`seasonName`** — cosmetic.
- **`isPaused`** — hard gate on `advanceTime`. Throws if true.

Staff manage it via `/time status | advance | preview | set | pause | unpause` (`packages/bot/src/commands/simulation/time.ts`). Both `/time advance` and `/time preview` are thin wrappers around the canonical service functions in `packages/api/src/services/simulationService.ts` — there's no inline duplication, so the bot and the webapp behave identically.

---

## 2. Date arithmetic — the rules of the calendar

All date math lives in `packages/shared/src/utils/aging.ts`. Two formats, four tick units, one important asymmetry.

**`parseSimDate(str)`** distinguishes:
- **ISO** — `YYYY-MM-DD`. Full day/month/year resolution.
- **Freeform** — `Year N, Month M`. Only month/year resolution; day is implicitly `1`.

**`advanceDateByTicks(dateStr, ticks, tickUnit)`**:
- ISO + any unit → fine. Day/week ticks use UTC date arithmetic. Month/year ticks target the intended calendar month/year and clamp the day when needed, so January 31 + 1 month becomes February 28 (or 29 in a leap year), and twelve monthly ticks stay aligned with one yearly tick.
- Freeform + `month` or `year` → fine. Manual modulo on the month, carries to year.
- **Freeform + `day` or `week` → throws.** Freeform has no day resolution. The error message points the operator at switching to ISO or coarser ticks.

**`calculateAge(birthDate, currentDate)`** is the source of truth for age:
- Both null → `null`.
- Mixed formats (one ISO, one freeform) → year-only diff (best effort).
- Same format → `now.year - birth.year`, minus 1 if the birthday hasn't landed yet this year. Day-precision when ISO; month-precision when freeform.
- Floors at 0 — no negative ages ever leak out.

**`birthDateForAge(currentDate, ageYears)`** is the inverse: anchor a birth at month 1 / day 1 of `currentDate.year - ageYears`, in the same format as the clock.

**`ageIncrementPerTick(unit)`** returns fractional years (1, 1/12, 1/52, 1/365). Used for *display previews only* — it never participates in authoritative aging. Authoritative age is always `calculateAge(birthDate, simNow)`.

---

## 3. Character creation — where birthDate is born

Two entry points: `/character create` (player self-serve, `packages/bot/src/commands/player/character.ts`) and `/player-admin character-create` (staff-on-behalf-of, `packages/bot/src/commands/player/admin.ts`). Both follow the same pattern:

1. Player picks `startingAge` (validated `18 ≤ age ≤ 70` — the modal hardcodes the bounds; `AgingConfig.{min,max,defaultStartingAge}` are the same numbers, used for hints/defaults).
2. `birthDate = birthDateForAge(simulationClock.currentDate, startingAge)` — anchored to the clock's current date *at character creation time*. So if the season is at `Year 4, Month 7`, an age-30 character gets birthDate `Year -26, Month 1`.
3. Both `players.startingAge` and `players.currentAge` are written. `startingAge` is immutable historical record; `currentAge` is a denormalized cache that gets updated each `advanceTime`.
4. `players.birthDate` is the **source of truth**. If `currentAge` ever drifts, recompute from `birthDate` against the clock — that's what `calculateAge` does, and what `generateObituary` falls back to.

### Starting-age favour bonus

Older characters trade lifespan for political capital. From `playerService.ts`:

```
35+  →  1 favour
45+  →  2
60+  →  3
```

Highest tier wins (so a 60-year-old gets 3, not 3+2+1). On character creation, the bonus is applied automatically to the active favour category whose name or short name exactly matches the selected faction's name or short name. `startingFavoursGranted` is set to `true` only after that ledger transaction is written. If no matching category exists, creation still succeeds and staff can correct the ledger manually.

---

## 4. The aging pipeline — `advanceTime(db, ticks, advancedById)`

This is the one big ceremony. Lives in `simulationService.ts`. Step by step:

### 4a. Setup
- Load the clock. Refuse if missing or paused.
- Load `agingConfig` (or `DEFAULT_AGING_CONFIG`).
- Compute `perTickDates`: an array of length `ticks + 1`. `[0]` is the start date, `[N]` is the date after `N` ticks. Throws here if config is freeform + sub-month ticks.
- Select all players with `isAlive = true`. Dead players are *never* re-rolled.

### 4b. Per-player simulation loop — `simulatePlayerTicks`

Each player walks through `ticks` sequential ticks. **Critically, each tick is rolled separately** — multi-tick advances loop the dice per tick. So `/time advance ticks:5` is statistically equivalent to five 1-tick calls; it's not a single batched roll with a higher coefficient.

For each tick:

1. **Age this tick** = `calculateAge(birthDate, perTickDates[i+1])`. So the dice are rolled against the age the character is at *that specific tick's date*, not their age at the start of the advance.
2. **Ailment roll** (`rollSingleTick`):
   - Skipped entirely if `age < ailmentAgeThreshold` (default 50).
   - Otherwise, compute the monthly baseline: `monthlyChance = ailmentBaseChance + (age - threshold) * ailmentAgeScaling` → `0.008 + (age-50)*0.003` by default. So at 50: 0.8%, at 60: 3.8%, at 70: 6.8% per month.
   - Year ticks are split into twelve internal monthly roll steps. Month ticks use one monthly roll. Day/week ticks use proportional fractional scaling with `1 - (1 - monthlyChance) ** monthsCoveredByTick`.
   - On hit, pick from `ailmentPool` weighted by `weight`, filtered by `minAge`. **Duplicate guard**: if the player already has that condition, the roll is discarded (no stacking the same disease).
   - The new ailment goes into the player's local `state.ailments` array immediately, so the *very same tick's* death roll can see it.
3. **Death roll**:
   - **Critical ailments**: each adds `criticalAilmentDeathChance` (default 0.22) to `deathChance`. Cause = first critical ailment's name.
   - **Major-ailment stacks**: 2+ majors → `+0.05 * majorCount`. So 2 majors = +0.10, 3 = +0.15. Cause defaults to `"complications from multiple ailments"` if no critical was set.
   - **Old age**: if `age ≥ deathAgeThreshold` (default 62), `monthlyAgeDeathChance = 0.003 + (age-62)*0.005`. So at 62: 0.3%, at 65: 1.8%, at 70: 4.3%, at 80: 9.3% per month. The monthly `deathChance` is `Math.max(deathChance, monthlyAgeDeathChance)` — they don't add. If old-age happens to dominate, cause becomes `"natural causes"`.
   - The final death chance follows the same tick-length treatment as ailments. A default yearly tick rolls twelve internal monthly death chances, so threshold birthdays inside the year are handled month-by-month.
   - Roll `Math.random() < deathChance`. On hit, the tick loop **breaks immediately** for that player — no further ticks rolled. Automatic hits do not kill immediately; they create a pending death marker for the next time-advance window.

### 4c. Persistence — wrapped in `db.transaction`

All of the below happens inside one transaction so a partial advance never strands the world:

- For each living player:
  - If `profileData.pendingDeath` exists and the next tick is eligible, process that pending death before rolling the player again.
  - If they aged or got new ailments: `UPDATE players SET currentAge, ailments, healthStatus`. `healthStatus` is recomputed from the *worst* severity in the array (`critical > major > minor > healthy`).
  - For each new ailment: `INSERT INTO playerEventLog` with `eventType='ailment_acquired'`, `isAutomatic=true`, the ailment object in `newValue`, and the tick/date when it landed.
  - If a death roll hits: store `profileData.pendingDeath`, log `eventType='death_pending'`, and return it in `pendingDeathDetails`. The player remains alive and keeps offices until the next advance.
- Update `simulationClock` with `currentTick = toTick`, `currentDate = toDate`.
- Insert one `timeAdvanceLog` row summarising the whole advance: `{ deaths: [...playerIds], pendingDeaths: [...playerIds], ailments: [...playerIds], aged: number }`.

### 4d. Return value
`AdvanceResult` — same shape as `previewAdvance` returns, with `deathDetails`, `pendingDeathDetails`, and `ailmentDetails` arrays the bot uses to render its embed.

---

## 5. Death handling — `processPlayerDeath`

Single shared helper used by both automatic deaths (from `advanceTime`) and `manualDeath` (staff `/api/simulation/death`). Accepts either a `Database` or a transaction handle.

It does four things, in order:

1. **Mark the player dead**: `isAlive=false`, `deathDate`, `causeOfDeath`, `healthStatus='deceased'`.
2. **Log a `death` event** in `playerEventLog` with `newValue: { causeOfDeath, deathDate }` and the tick/date.
3. **Vacate offices**: select every `officeHolders` row where `playerId = X AND endDate IS NULL`, set `endDate=NOW()` and `removalReason='died'`.
4. **Log an `office_left` event** per vacated office, so dossier and obituary can show "vacated <Office> (died in office)".

`isAutomatic` is set to `true` for time-advance deaths and `false` for `manualDeath` — so the event log can distinguish an act of staff from an act of the dice.

Automatic deaths now pass through a one-advance settle-affairs period first. The proc is recorded as `death_pending` in the event log and as `profileData.pendingDeath` on the player. The next `/time advance` finalizes the death before any further rolls for that player. Manual staff deaths bypass this and still call `processPlayerDeath` immediately.

---

## 6. Default aging config

From `DEFAULT_AGING_CONFIG` in `simulationService.ts`. All probability knobs are monthly baselines; the engine applies them per internal month for year/month ticks and scales them proportionally for day/week ticks. All knobs live in `simulation_clock.aging_config` (JSONB) when overridden per-season.

**Ailment knobs:**
- `ailmentAgeThreshold` = **50** — age below this gets zero ailment rolls.
- `ailmentBaseChance` = **0.008** — monthly baseline chance at exactly the threshold age.
- `ailmentAgeScaling` = **0.003** — linear bonus per year above threshold.

**Death knobs:**
- `deathAgeThreshold` = **62** — age below this gets no old-age death roll.
- `deathBaseChance` = **0.003** — monthly baseline chance at exactly the threshold age.
- `deathAgeScaling` = **0.005** — linear bonus per year above threshold.
- `criticalAilmentDeathChance` = **0.22** — per critical ailment, additive.

**Character-creation bounds:** `minStartingAge` / `max` / `default` = **18 / 70 / 30**.

With the schema's one-year tick default, those monthly baselines are rolled over twelve internal months. If a season overrides the clock to monthly ticks, the same baselines are applied one visible tick at a time.

### Default ailment pool

Weighted random pick, filtered by `minAge`. Once acquired, an ailment can't be re-rolled onto the same player. The default season is set in 2075, so ordinary curable conditions are excluded; the automatic pool uses normal but dangerous conditions that plausibly remain life-threatening.

- **cancer** — major, weight 3, no min age.
- **heart disease** — major, weight 2, min age 55.
- **kidney disease** — major, weight 2, min age 55.
- **liver disease** — major, weight 1, min age 55.
- **pulmonary fibrosis** — major, weight 1, min age 55.
- **chronic obstructive pulmonary disease** — major, weight 1, min age 60.
- **Parkinson's disease** — major, weight 1, min age 60.
- **dementia** — major, weight 1, min age 65.
- **stroke** — critical, weight 1, min age 60.
- **sepsis** — critical, weight 1, min age 60.
- **pulmonary embolism** — critical, weight 1, min age 60.
- **ruptured aneurysm** — critical, weight 1, min age 60.
- **heart failure** — critical, weight 1, min age 65.
- **organ failure** — critical, weight 1, min age 70.

Total pool weight depends on age (eligibility filter): ages 50–54 see weight 3, 55–59 see weight 9, 60–64 see 15, 65–69 see 17, and 70+ see 18. Critical ailments remain age-gated to 60+, so under defaults you can't acquire a critical ailment before 60.

---

## 7. Manual interventions — staff overrides

All four require staff (`requireAuth + requireStaff` on the API; `ManageGuild` on the bot).

- **Assign ailment** — `/ailment add user condition severity` (bot) or `POST /api/simulation/ailment` → `manualAilment`.
- **Cure ailment, exact match** — `/ailment remove user condition` (bot, inline; no API route).
- **Cure ailment, fuzzy match** — `/heal user ailment` (bot) or `POST /api/simulation/heal` → `heal`.
- **Kill character** — `/kill user cause` (bot) or `POST /api/simulation/death` → `manualDeath` (API) / `processPlayerDeath` (bot).

`manualAilment` refuses to assign to dead characters and refuses duplicates. `heal` does case-insensitive `includes` lookup and disambiguates if multiple ailments match — it asks the operator to be more specific instead of guessing. Both write `playerEventLog` entries with `isAutomatic=false` and the staff member as `triggeredById`. `manualDeath` reuses the same `processPlayerDeath` helper as automatic death — same office-vacation logic, same cause-of-death recording.

There's also `/heal` vs `/ailment remove`. They differ only in lookup style: `/ailment remove` is exact-match (and lives directly in the bot), `/heal` is fuzzy + ambiguity-aware (and goes through the API service). Both produce the same database state.

---

## 8. Preview — `previewAdvance`

Same logic as `advanceTime`, no writes. It builds the same `perTickDates`, copies each player's `state` into a local object, and runs `simulatePlayerTicks`. The dice fall the same way the real call would *for that random seed* — but Node's `Math.random` is not seeded, so the two calls aren't reproducible. Treat preview as a sample of what could happen, not a guaranteed forecast. The `/time preview` embed is ephemeral and labelled "This is a preview — nothing has been committed."

---

## 9. Obituary — `generateObituary`

When a character dies, `generateObituary(db, playerId)` assembles a narrative from their `playerEventLog`:

- **Age at death**: prefers `calculateAge(birthDate, deathDate)` — both are stored, both are sim-time strings, so this gives the correct historical age even if `currentAge` got out of sync. Falls back to `currentAge` if either date is missing.
- **Party history**: filtered by `eventType='party_change'`. Last entry's party is named in the narrative.
- **Offices held**: filtered to `office_appointed` / `office_left`. Each appointment is listed.
- **Cause of death**: from `players.causeOfDeath`.

Returns a structured payload (used by webapp Graveyard / character dossier) plus a one-paragraph string `narrative` ready for embed display.

---

## 10. Edge cases & gotchas

- **Freeform + day/week ticks throw.** The error fires inside `buildPerTickDates` *before* any DB writes, so a misconfigured clock can't half-advance. If the season uses `Year N, Month M` dates, the clock's `tickUnit` must be `month` or `year`.
- **Mixed-format age calc** silently degrades to year-only. If you migrate the clock from freeform → ISO mid-season, existing players' birthDates stay freeform and their ages will be approximate (year-only) until you also rewrite their birth dates.
- **Death short-circuits the per-player tick loop** but not the per-player outer loop. Other living players keep being rolled for the remaining ticks even after one player dies mid-advance.
- **Same-tick ailment + death proc.** A character can acquire a critical ailment on tick `T` and trigger a death roll from it on the same tick — the death roll on tick `T` sees the ailment that was just added. The actual automatic death is still deferred to the next advance.
- **`currentAge` is denormalized**, not authoritative. Anywhere correctness matters (obituary, dossier age display), prefer `calculateAge(birthDate, simNow)`. The cache exists for speed and for offline display when the clock is unreachable.
- **`startingFavoursGranted` is sticky once true.** It flips to true only after the automatic ledger grant succeeds. The automatic grant uses the selected faction to find an active matching favour category by exact name/short-name match; there is no separate idempotency token on the favour transaction itself.
- **No DB unique constraint on ailment condition per player.** Duplicate suppression is enforced in code (both manual and automatic paths). If two parallel `advanceTime` calls ever ran simultaneously (they shouldn't — there's no app-level lock), they could in theory race. The transactional wrapping limits but doesn't formally prevent this.
- **Min/max starting age is hardcoded twice** — once in the modal validator (`MIN_STARTING_AGE`/`MAX_STARTING_AGE` constants in the bot) and once in the API route (`< 18 || > 70`). `AgingConfig.minStartingAge` / `maxStartingAge` exist in the type but aren't actually consulted at the validation step — they're hint metadata. If you change those config numbers, also update the route + modal constants.

---

## 11. Quick reference — what runs when

- **`/character create`** — new player row, `birthDate = birthDateForAge(simNow, age)`, favour bonus tier looked up, registration event logged.
- **`/time advance ticks:N`** — per-tick per-player ailment + death rolls, all in one transaction. Logs `ailment_acquired` / `death` / `office_left` events. Updates clock. Writes `timeAdvanceLog`.
- **`/time preview ticks:N`** — same logic, no writes. Ephemeral embed.
- **`/time set date:X`** — direct UPDATE on `currentDate`. **Does not** retro-age players — `calculateAge` will pick up the new date next read, but cached `currentAge` stays stale until next advance.
- **`/time pause` / `unpause`** — toggles `isPaused`. `advanceTime` throws if paused.
- **`/ailment add`** — manual JSONB push + `ailment_acquired` log (`isAutomatic=false`).
- **`/ailment remove` / `/heal`** — manual JSONB filter + `ailment_recovered` log.
- **`/kill` / `manualDeath` (API)** — same `processPlayerDeath` path as automatic; `isAutomatic=false`.
