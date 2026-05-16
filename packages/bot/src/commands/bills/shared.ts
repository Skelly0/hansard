/**
 * Shared utilities for bill commands.
 */

/**
 * Extract the Google Doc ID from a URL.
 */
export function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

/**
 * Format a bill status for display.
 */
export function formatBillStatus(status: string): string {
  const statusMap: Record<string, string> = {
    submitted: 'Submitted',
    withdrawn: 'Withdrawn',
    voting: 'In Vote',
    player_passed: 'Passed (Player House)',
    player_rejected: 'Rejected (Player House)',
    npc_pending: 'NPC House Pending',
    npc_passed: 'Passed (NPC House)',
    npc_rejected: 'Rejected (NPC House)',
    enacted: 'Enacted',
    active: 'Active',
    amended: 'Amended',
    repealed: 'Repealed',
  };

  return statusMap[status] ?? status;
}

/**
 * Get a status emoji for display.
 */
export function statusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    submitted: '\u{1F4E5}',      // inbox tray
    withdrawn: '\u{21A9}\u{FE0F}', // leftwards arrow with hook
    voting: '\u{1F5F3}\u{FE0F}', // ballot box
    player_passed: '\u{2705}',    // check
    player_rejected: '\u{274C}',  // cross
    npc_pending: '\u{23F3}',      // hourglass
    npc_passed: '\u{2705}',
    npc_rejected: '\u{274C}',
    enacted: '\u{1F4DC}',        // scroll
    active: '\u{1F7E2}',         // green circle
    amended: '\u{1F4DD}',        // memo
    repealed: '\u{1F6AB}',       // no entry
  };

  return emojiMap[status] ?? '\u{2753}';
}
