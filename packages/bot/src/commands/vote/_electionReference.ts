import { eq, ilike, sql } from 'drizzle-orm';
import { elections, type Database } from '@hansard/db';
import { REACTION_COMPATIBLE_METHODS } from '@hansard/shared';

export type ElectionReference =
  | { kind: 'id'; value: string }
  | { kind: 'id-prefix'; value: string }
  | { kind: 'title'; value: string };

export type VoteInterface = 'buttons' | 'reactions';

const FULL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE =
  /^[0-9a-f]{8}(?:-[0-9a-f]{0,4})?(?:-[0-9a-f]{0,4})?(?:-[0-9a-f]{0,4})?(?:-[0-9a-f]{0,12})?$/i;

export function describeElectionReference(input: string): ElectionReference {
  const value = input.trim();
  const normalized = value.toLowerCase();

  if (FULL_UUID_RE.test(normalized)) {
    return { kind: 'id', value: normalized };
  }

  if (UUID_PREFIX_RE.test(normalized)) {
    return { kind: 'id-prefix', value: normalized };
  }

  return { kind: 'title', value };
}

export function getDefaultVoteInterface(_method: string): VoteInterface {
  return REACTION_COMPATIBLE_METHODS.includes(_method as never) ? 'reactions' : 'buttons';
}

export function getRequestedVoteInterface(
  requested: string | null,
  method: string,
): VoteInterface {
  return requested === 'reactions' || requested === 'buttons'
    ? requested
    : getDefaultVoteInterface(method);
}

export function formatElectionReference(reference: ElectionReference): string {
  return reference.kind === 'title'
    ? `title \`${reference.value}\``
    : `ID \`${reference.value}\``;
}

export async function findElectionByReference(
  database: Database,
  input: string,
): Promise<{
  election: typeof elections.$inferSelect | null;
  errorMessage: string | null;
  reference: ElectionReference;
}> {
  const reference = describeElectionReference(input);

  const where =
    reference.kind === 'id'
      ? eq(elections.id, reference.value)
      : reference.kind === 'id-prefix'
        ? sql`${elections.id}::text ILIKE ${`${reference.value}%`}`
        : ilike(elections.title, reference.value);

  const rows = await database.select().from(elections).where(where).limit(2);

  if (reference.kind === 'id-prefix' && rows.length > 1) {
    return {
      election: null,
      errorMessage: `Election ID prefix \`${reference.value}\` matches multiple elections. Paste the full election ID.`,
      reference,
    };
  }

  const election = rows[0] ?? null;

  return {
    election,
    errorMessage: election ? null : `No election found with ${formatElectionReference(reference)}.`,
    reference,
  };
}
