// ============================================================
// Phone registry constants
// ============================================================

/** How long a ring can sit unanswered before the worker marks the call missed. */
export const PHONE_RING_TIMEOUT_MS = 60 * 1000;

/**
 * Number normalization regex. After stripping all non-digit characters (preserving an
 * optional leading `+`), the result must match this pattern.
 *
 * 3-20 digits keeps short numbers like `911`, `42` available for roleplay flavor while
 * rejecting Unicode/emoji content and pathologically long input.
 */
export const PHONE_NUMBER_REGEX = /^\+?\d{3,20}$/;

/** Maximum phone numbers an active player may hold simultaneously. */
export const PHONE_NUMBERS_PER_PLAYER_LIMIT = 5;

/**
 * Canonical reason strings — re-used by Discord command replies, web error responses,
 * and API errors so a player never sees two different phrasings of the same refusal.
 */
export const PHONE_INELIGIBLE_DEAD = 'A deceased character cannot place or receive calls.';
export const PHONE_INELIGIBLE_NO_CHARACTER = 'You need an active character before you can register a phone number.';
export const PHONE_ALREADY_ON_CALL = 'You are already on a call. Hang up first with `/phone hangup`.';
export const PHONE_NUMBER_TAKEN = 'That number is already registered to another line.';
export const PHONE_NUMBER_INVALID = 'Phone numbers must be 3-20 digits, optionally prefixed with `+`.';
export const PHONE_NUMBER_NOT_FOUND = 'No active line found with that number.';
export const PHONE_RECIPIENT_DM_CLOSED = 'Recipient has DMs closed and could not be reached.';

/**
 * Normalize a player-entered phone number for uniqueness lookup. Strips all
 * non-digit characters except a single leading `+`.
 */
export function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/** True if the input is a syntactically valid phone number after normalization. */
export function isValidPhoneNumber(input: string): boolean {
  return PHONE_NUMBER_REGEX.test(normalizePhoneNumber(input));
}

/** Pretty-print a number for display. Leaves any user-chosen formatting alone. */
export function formatPhoneNumber(raw: string): string {
  return raw.trim();
}
