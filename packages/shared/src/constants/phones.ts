// ============================================================
// Phone registry constants
// ============================================================

/** How long a ring can sit unanswered before the worker marks the call missed. */
export const PHONE_RING_TIMEOUT_MS = 60 * 1000;

/** How often the ring-timeout worker polls for `ringing` calls that have expired. */
export const PHONE_RING_WORKER_INTERVAL_MS = 30_000;

/**
 * DM chunking budget. Relay messages longer than this are split into multiple DMs so
 * each stays comfortably under Discord's 2000-character message limit.
 */
export const PHONE_DM_CHUNK_BUDGET = 1900;

/** How old an `active` call must be before the startup sweep treats it as crash-stranded. */
export const PHONE_STRANDED_CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How old a still-pending `phone_message_tap_deliveries` placeholder may be before the
 * worker sweep treats it as crash-stranded. `recordMessage` pre-creates these rows inside
 * the message transaction and the relay normally completes them within seconds; a row
 * still `delivered_at IS NULL AND error IS NULL` after this window means the relay crashed
 * or threw before reporting the send result, so the sweep marks it with an error note.
 * 10 minutes is well over any realistic relay fan-out (sequenced, but each tap is fast).
 */
export const PHONE_STALE_TAP_DELIVERY_MAX_AGE_MS = 10 * 60 * 1000;

/** How long to wait between "not in a call" hints to the same DM-er. */
export const PHONE_HINT_COOLDOWN_MS = 60 * 1000;

/**
 * Force-end persisted reason prefix. Service emits `${prefix}${note.slice(0, 59)}` so the
 * note is visible in `phone_calls.ended_reason` and `/phone history`.
 */
export const PHONE_FORCE_END_REASON_PREFIX = 'force_ended_by_staff:';

/** How many consecutive failed deliveries before the relay auto-disables a tap. */
export const PHONE_TAP_FAILURE_THRESHOLD = 5;

/** Max length for each configured voicemail line message. */
export const PHONE_VOICEMAIL_MESSAGE_MAX_LENGTH = 1000;

/** Max length for a public phone-line pseudonym. */
export const PHONE_PSEUDONYM_MAX_LENGTH = 128;

/** How long a caller has after the peep before an unanswered voicemail session is closed. */
export const PHONE_VOICEMAIL_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

/** How long a claimed-but-unstamped voicemail peep can sit before another worker may retry it. */
export const PHONE_VOICEMAIL_PEEP_CLAIM_STALE_MS = 2 * 60 * 1000;

/** Max length for slash-command text messages. Freeform DM chunking still uses DM budget. */
export const PHONE_TEXT_MESSAGE_MAX_LENGTH = 1900;

/** How long a claimed text delivery can sit before the worker returns it to the queue. */
export const PHONE_TEXT_DELIVERY_CLAIM_STALE_MS = 2 * 60 * 1000;

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
export const PHONE_RECIPIENT_BUSY = 'That line is busy on another call. Try again later.';
export const PHONE_NUMBER_TAKEN = 'That number is already registered to another line.';
export const PHONE_NUMBER_INVALID = 'Phone numbers must be 3-20 digits, optionally prefixed with `+`.';
export const PHONE_NUMBER_NOT_FOUND = 'No active line found with that number.';
export const PHONE_RECIPIENT_DM_CLOSED = 'Recipient has DMs closed and could not be reached.';
export const PHONE_TEXT_NO_CONVERSATION =
  'You are not in a call and do not have a selected text conversation. Use `/phone dial` to call, `/phone text` to start texting, or `/phone conversations` and `/phone switch` to pick an existing conversation.';
export const PHONE_TEXT_MULTIPLE_CONVERSATIONS =
  'You have multiple active text conversations. Use `/phone conversations` and `/phone switch` before replying in DM.';
export const PHONE_TEXT_ARCHIVED =
  'That text conversation is archived. Start a new one with `/phone text`.';

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

/** Clean an optional public alias for a phone line. Blank aliases are stored as null. */
export function cleanPhonePseudonym(input: string | null | undefined): string | null {
  const cleaned = input
    ?.replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, PHONE_PSEUDONYM_MAX_LENGTH);
}

/**
 * Map a `phone_calls.ended_reason` value to a human-readable description for `/phone history`,
 * the staff thread "call ended" embed, and web call logs. Keeps the strings in one place so
 * UI surfaces stay aligned.
 *
 * `force_ended_by_staff:<note>` is normalized to "Ended by staff: <note>".
 */
export function formatPhoneEndedReason(reason: string | null | undefined): string {
  if (!reason) return 'Ended';
  if (reason.startsWith('force_ended_by_staff:')) {
    const note = reason.slice('force_ended_by_staff:'.length).trim();
    return note ? `Ended by staff: ${note}` : 'Ended by staff';
  }
  switch (reason) {
    case 'hangup_caller': return 'Caller hung up';
    case 'hangup_recipient': return 'Recipient hung up';
    case 'cancelled_by_caller': return 'Cancelled before pickup';
    case 'declined_by_recipient': return 'Declined';
    case 'ring_timeout': return 'No answer';
    case 'force_ended_by_staff': return 'Ended by staff';
    case 'dm_closed': return 'Recipient unreachable';
    case 'relay_failed': return 'Relay failed';
    case 'session_reset': return 'Bot restart';
    case 'number_deactivated': return 'Line retired';
    case 'voicemail_left': return 'Voicemail left';
    case 'voicemail_abandoned': return 'Voicemail abandoned';
    default: return reason;
  }
}

/** Format a `phone_calls.status` value for player-facing surfaces. */
export function formatPhoneCallStatus(status: string): string {
  switch (status) {
    case 'ringing': return 'Ringing';
    case 'active': return 'Active';
    case 'ended': return 'Ended';
    case 'declined': return 'Declined';
    case 'missed': return 'Missed';
    case 'cancelled': return 'Cancelled';
    case 'voicemail': return 'Voicemail';
    default: return status;
  }
}
