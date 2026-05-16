/**
 * Backfill script: repair character birth dates that were set against the
 * wall-clock year (~2026) instead of the simulation clock (2075+).
 *
 * Bug history: prior to commit d0c62d1 (2026-05-11), `birthDateForAge` fell
 * back to `new Date().getUTCFullYear()` when the simulation clock was
 * unparseable or temporarily unavailable, producing birth dates ~49 years
 * earlier than intended. On the next `/time advance` that crossed a year
 * boundary the cached `currentAge` was recomputed to (sim_year − bad_birth_year)
 * = startingAge + ~49, which has been visibly inflating ages and triggering
 * spurious automatic deaths.
 *
 * Detection: instead of trusting an absolute year sentinel (which would
 * misclassify a legitimately-old 70-year-old whose birth year overlaps the
 * buggy range), we look at the *gap* between the implied age and the
 * intended starting age. The bug always produces a ~49-year inflation, so a
 * gap of 40+ is the safe threshold.
 *
 * Repair: snap birth_date so the character is exactly their starting age
 * right now (alive rows) or exactly their starting age at the death date
 * (dead rows). Some "sim time elapsed since creation" is lost for chars who
 * had been ageing correctly, but we have no reliable record of the original
 * in-sim creation date to reconstruct that.
 *
 * Flags:
 *   --dry-run             Print the proposed changes without writing.
 *   --include-dead        Also fix dead character rows. Default: yes.
 *   --alive-only          Only fix living characters (skip already-dead rows).
 *   --age-gap-threshold=N Minimum impliedAge−intendedAge to consider buggy
 *                         (default 40; the bug's exact offset is ~49).
 *
 * Run with: `pnpm --filter @hansard/db fix:character-birth-dates [--dry-run]`
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREEFORM_RE = /^Year\s+(\d+),?\s*Month\s+(\d+)$/i;
export const WALL_CLOCK_BUG_YEAR = 2026;

export interface PlayerRow {
  id: string;
  discord_username: string;
  character_name: string | null;
  is_alive: boolean;
  starting_age: number | null;
  current_age: number | null;
  birth_date: string | null;
  death_date: string | null;
}

export interface ParsedSimDate {
  format: 'iso' | 'freeform';
  year: number;
  month: number;
  day: number;
}

export function parseSimDate(dateStr: string | null): ParsedSimDate | null {
  if (!dateStr) return null;
  const iso = dateStr.match(ISO_RE);
  if (iso) {
    return {
      format: 'iso',
      year: parseInt(iso[1]!, 10),
      month: parseInt(iso[2]!, 10),
      day: parseInt(iso[3]!, 10),
    };
  }
  const free = dateStr.match(FREEFORM_RE);
  if (free) {
    return {
      format: 'freeform',
      year: parseInt(free[1]!, 10),
      month: parseInt(free[2]!, 10),
      day: 1,
    };
  }
  return null;
}

function formatIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateAge(birth: ParsedSimDate, now: ParsedSimDate): number {
  let age = now.year - birth.year;
  if (now.month < birth.month || (now.month === birth.month && now.day < birth.day)) {
    age -= 1;
  }
  return Math.max(0, age);
}

export interface PlannedFix {
  playerId: string;
  characterName: string | null;
  isAlive: boolean;
  oldBirthDate: string;
  newBirthDate: string;
  oldCurrentAge: number | null;
  newCurrentAge: number | null;
  reason: string;
}

export function planFix(
  player: PlayerRow,
  simClock: ParsedSimDate,
  ageGapThreshold: number,
  deathClock: ParsedSimDate | null,
): PlannedFix | null {
  const parsedBirth = parseSimDate(player.birth_date);
  if (!parsedBirth) return null;
  // Freeform dates have month resolution only and weren't subject to the
  // wall-clock-anchored bug (which always emitted ISO).
  if (parsedBirth.format !== 'iso') return null;

  // Best estimate of intended age. starting_age is the user's chosen age at
  // creation and is preserved by the bug, so trust it. Fall back to
  // current_age if missing (legacy imports).
  const intendedAge = player.starting_age ?? player.current_age;
  if (intendedAge == null) return null;

  // Computed age against the appropriate clock — sim clock for living,
  // death date for dead.
  const referenceClock = player.is_alive ? simClock : (deathClock ?? simClock);
  const impliedAge = calculateAge(parsedBirth, referenceClock);
  const gap = impliedAge - intendedAge;
  if (gap < ageGapThreshold) return null;

  // Snap birth_date so the character is exactly intendedAge at the
  // reference clock.
  const newBirthYear = referenceClock.year - intendedAge;
  // Subtract one more year if the birthday hasn't yet occurred in the
  // reference clock's year — preserves month/day anchoring.
  const birthdayPassed =
    referenceClock.month > parsedBirth.month
    || (referenceClock.month === parsedBirth.month && referenceClock.day >= parsedBirth.day);
  const finalBirthYear = birthdayPassed ? newBirthYear : newBirthYear - 1;
  const newBirthDate = formatIso(finalBirthYear, parsedBirth.month, parsedBirth.day);

  return {
    playerId: player.id,
    characterName: player.character_name,
    isAlive: player.is_alive,
    oldBirthDate: player.birth_date!,
    newBirthDate,
    oldCurrentAge: player.current_age,
    newCurrentAge: intendedAge,
    reason: `impliedAge ${impliedAge} − intendedAge ${intendedAge} = ${gap} ≥ ${ageGapThreshold} (wall-clock bug)`,
  };
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  aliveOnly: boolean;
  ageGapThreshold: number;
} {
  let dryRun = false;
  let aliveOnly = false;
  let ageGapThreshold = 40;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--alive-only') aliveOnly = true;
    else if (arg === '--include-dead') aliveOnly = false;
    else if (arg.startsWith('--age-gap-threshold=')) {
      const n = parseInt(arg.slice('--age-gap-threshold='.length), 10);
      if (Number.isFinite(n) && n > 0) ageGapThreshold = n;
    }
  }
  return { dryRun, aliveOnly, ageGapThreshold };
}

async function main() {
  const { dryRun, aliveOnly, ageGapThreshold } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    // `current_date` is a Postgres reserved keyword (returns the wall-clock
    // date function); quote it so we read the column.
    const [clock] = await sql<{ current_date: string }[]>`
      SELECT "current_date" FROM simulation_clock LIMIT 1
    `;
    const parsedClock = parseSimDate(clock?.current_date ?? null);
    if (!parsedClock) {
      console.error(
        `Cannot read simulation_clock.current_date (got "${clock?.current_date ?? '<missing>'}"). ` +
        'Refusing to backfill without a sim clock anchor.',
      );
      process.exit(2);
    }
    if (parsedClock.year <= WALL_CLOCK_BUG_YEAR) {
      console.error(
        `Simulation clock year (${parsedClock.year}) is not after the wall-clock bug baseline ` +
        `(${WALL_CLOCK_BUG_YEAR}). No correction needed or the sim clock is itself misconfigured.`,
      );
      process.exit(3);
    }
    console.log(`Simulation clock: ${clock.current_date} (year ${parsedClock.year})`);
    console.log(`Threshold: impliedAge − intendedAge ≥ ${ageGapThreshold} → treat as wall-clock-bugged.`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'} | ${aliveOnly ? 'alive only' : 'alive + dead'}`);

    const allPlayers = await sql<PlayerRow[]>`
      SELECT id, discord_username, character_name, is_alive,
             starting_age, current_age, birth_date, death_date
      FROM players
      WHERE birth_date IS NOT NULL
    `;

    const plans: PlannedFix[] = [];
    for (const p of allPlayers) {
      if (aliveOnly && !p.is_alive) continue;
      const deathClock = p.is_alive ? null : parseSimDate(p.death_date);
      const plan = planFix(p, parsedClock, ageGapThreshold, deathClock);
      if (plan) plans.push(plan);
    }

    console.log(`Found ${plans.length} player row(s) needing repair (of ${allPlayers.length} with a birth_date).`);
    for (const plan of plans) {
      const tag = plan.isAlive ? 'ALIVE' : 'DEAD ';
      console.log(
        `  [${tag}] ${plan.playerId}  ${plan.characterName ?? '(unnamed)'} ` +
        `birth_date ${plan.oldBirthDate} -> ${plan.newBirthDate}  ` +
        `current_age ${plan.oldCurrentAge ?? '∅'} -> ${plan.newCurrentAge ?? '∅'}  (${plan.reason})`,
      );
    }

    if (dryRun || plans.length === 0) {
      console.log(dryRun ? 'DRY RUN: no changes applied.' : 'Nothing to do.');
      return;
    }

    let applied = 0;
    await sql.begin(async (tx) => {
      const trx = tx as unknown as typeof sql;
      for (const plan of plans) {
        await trx`
          UPDATE players
          SET birth_date = ${plan.newBirthDate},
              current_age = ${plan.newCurrentAge}
          WHERE id = ${plan.playerId}
        `;
        applied++;
      }
    });
    console.log(`Applied ${applied} row update(s).`);
  } finally {
    await sql.end();
  }
}

// Only run the side-effecting main() when executed directly, not when this
// module is imported by unit tests. `pathToFileURL` normalizes Windows paths
// (backslashes, drive letters) so the comparison works cross-platform.
const invokedDirectly =
  typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
