// ============================================================
// Default Configuration Constants
// ============================================================

/** The canonical bot name used in embeds, footers, and logging */
export const DEFAULT_BOT_NAME = 'Hansard';

/** Default voting window for newly-created votes and runoff rounds */
export const DEFAULT_VOTE_DURATION_HOURS = 24;
export const DEFAULT_VOTE_DURATION_MS = DEFAULT_VOTE_DURATION_HOURS * 60 * 60 * 1000;

/** Canonical supermajority threshold: exactly two-thirds of yea+nay votes */
export const SUPERMAJORITY_PASS_THRESHOLD = 2 / 3;

/** Older persisted configs used the rounded value; keep recognizing it. */
export const LEGACY_SUPERMAJORITY_PASS_THRESHOLD = 0.667;

// ============================================================
// Discord Embed — Emoji Prefixes
// ============================================================

/** System emoji prefixes for Discord embed titles and labels */
export const EMOJI = {
  TICKETS: '\u{1F4CB}',       // 📋
  BILLS: '\u{1F4DC}',         // 📜
  VOTING: '\u{1F5F3}\uFE0F',  // 🗳️
  PLAYERS: '\u{1F464}',       // 👤
  OFFICES: '\u{1F3DB}\uFE0F', // 🏛️
  FAVOURS: '\u{1F91D}',       // 🤝
  GRAVEYARD: '\u{26B0}\uFE0F',// ⚰️
  SIMULATION: '\u{231B}',     // ⏳
  MODERATION: '\u{1F528}',    // 🔨
} as const;

// ============================================================
// Discord Embed — Colours (as hex numbers for discord.js)
// ============================================================

/**
 * Hex colour values for Discord embeds, keyed by system.
 * Pass directly to `EmbedBuilder.setColor()`.
 */
export const EMBED_COLOURS = {
  BILLS: 0xc4873b,
  VOTING: 0x6a9bcc,
  PLAYERS: 0x788c5d,
  OFFICES: 0x9b7cb8,
  FAVOURS: 0xc4873b,
  GRAVEYARD: 0x9c9890,
  TICKETS: 0x7b8ba8,
  MODERATION: 0xc25b4e,
  SIMULATION: 0x5d8c7b,
  PRIMARY: 0xd97757,
} as const;

// ============================================================
// CSS Colour Tokens (hex strings for webapp / non-Discord use)
// ============================================================

export const COLOURS = {
  PRIMARY: '#D97757',
  PRIMARY_LIGHT: '#F5E6DF',
  BILLS: '#C4873B',
  VOTING: '#6A9BCC',
  PLAYERS: '#788C5D',
  OFFICES: '#9B7CB8',
  FAVOURS: '#C4873B',
  TICKETS: '#7B8BA8',
  MODERATION: '#C25B4E',
  GRAVEYARD: '#9C9890',
  SIMULATION: '#5D8C7B',
} as const;

// ============================================================
// Status Colours (hex strings)
// ============================================================

export const STATUS_COLOURS = {
  OPEN: '#6A9BCC',
  ACTIVE: '#788C5D',
  PENDING: '#C4873B',
  CLOSED: '#9C9890',
  REJECTED: '#C25B4E',
  PASSED: '#788C5D',
  DECEASED: '#B0AEA5',
} as const;

// ============================================================
// Health Indicator Colours (hex strings)
// ============================================================

export const HEALTH_COLOURS = {
  HEALTHY: '#788C5D',
  MINOR: '#C4873B',
  MAJOR: '#D97757',
  CRITICAL: '#C25B4E',
} as const;
