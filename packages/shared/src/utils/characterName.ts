// Character name validation shared by the bot (`/character create`,
// `/player admin character-create`) and the API (`POST /api/players/create`).
//
// Drizzle/postgres.js parameterises every query, so quotes in a name cannot
// inject SQL — but names flow into Discord embed titles, plain message
// content (phone log openers), markdown formatting (`**${name}**`), and the
// playerEventLog description text. Names containing mention sigils, markdown
// markers, or invisible characters can break rendering or, in plain-content
// paths, trigger unintended pings. This module is the one place every entry
// point should call so the same rules apply everywhere.

export const MIN_CHARACTER_NAME_LENGTH = 2;
export const MAX_CHARACTER_NAME_LENGTH = 128;

// ASCII C0 + DEL + C1 controls, plus Unicode bidi/format/zero-width characters
// (ZWSP/ZWJ/ZWNJ, LTR/RTL marks, line/paragraph separators, BOM). These are
// invisible in Discord but break later string handling.
const DISALLOWED_INVISIBLE_RE = new RegExp(
  '[' +
    '\\u0000-\\u001F' + // C0 control
    '\\u007F-\\u009F' + // DEL + C1 control
    '\\u200B-\\u200F' + // zero-width + LTR/RTL marks
    '\\u202A-\\u202E' + // bidi embedding/override
    '\\u2060-\\u206F' + // word joiner + invisible operators
    '\\u2028\\u2029' + // line/paragraph separator
    '\\uFEFF' + // BOM / zero-width no-break space
    ']',
  'u',
);

// Discord/markdown sigils that break rendering or trigger mentions when a name
// ends up in plain message content (e.g. the phone log thread opener uses
// `**${callerName}**` as `content:` with only roles restricted, so an `@`
// in a stored name would parse as a real mention).
const DISALLOWED_DISPLAY_CHARS = ['@', '#', '`', '\\', '<', '>', '|'] as const;
const DISALLOWED_DISPLAY_RE = /[@#`\\<>|]/u;

const HAS_LETTER_RE = /\p{L}/u;

export interface ValidateCharacterNameResult {
  ok: boolean;
  /** The trimmed, whitespace-collapsed, NFC-normalised name when ok. */
  normalized?: string;
  /** Human-readable reason when not ok — safe to show in a Discord embed. */
  error?: string;
}

/**
 * Validate and normalise a character name. Allows letters from any script,
 * digits, spaces, quotes (straight and curly), apostrophes, hyphens, and
 * common punctuation. Rejects empty/whitespace-only input, invisible
 * characters, and Discord/markdown-breaking sigils.
 */
export function validateCharacterName(raw: unknown): ValidateCharacterNameResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Character name must be text.' };
  }

  // NFC folds decomposed sequences (e + combining acute) into composed form
  // (é) before length and uniqueness comparisons, so two visually identical
  // names hash the same.
  const trimmed = raw.normalize('NFC').trim();

  // Invisible-char check runs on the trimmed string *before* whitespace
  // collapsing: JS `\s` matches U+FEFF (BOM) and a few other invisible code
  // points, so collapsing first would silently rewrite a BOM in the middle
  // of a name into a regular space instead of flagging it.
  if (DISALLOWED_INVISIBLE_RE.test(trimmed)) {
    return {
      ok: false,
      error:
        'Character name contains invisible or control characters. Please retype it using only visible letters and punctuation.',
    };
  }

  // Collapse runs of ASCII space/tab to a single space. NBSP and other
  // legitimate whitespace can stay as-is — they're not invisible and won't
  // confuse downstream rendering.
  const normalized = trimmed.replace(/[ \t]+/g, ' ');

  if (normalized.length === 0) {
    return { ok: false, error: 'Character name cannot be empty.' };
  }

  if (normalized.length < MIN_CHARACTER_NAME_LENGTH) {
    return {
      ok: false,
      error: `Character name must be at least ${MIN_CHARACTER_NAME_LENGTH} characters.`,
    };
  }

  if (normalized.length > MAX_CHARACTER_NAME_LENGTH) {
    return {
      ok: false,
      error: `Character name must be ${MAX_CHARACTER_NAME_LENGTH} characters or fewer.`,
    };
  }

  if (DISALLOWED_DISPLAY_RE.test(normalized)) {
    return {
      ok: false,
      error: `Character name cannot contain any of: ${DISALLOWED_DISPLAY_CHARS.join(' ')}`,
    };
  }

  if (!HAS_LETTER_RE.test(normalized)) {
    return { ok: false, error: 'Character name must contain at least one letter.' };
  }

  return { ok: true, normalized };
}
