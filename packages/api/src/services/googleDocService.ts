import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills } from '@hansard/db';

// ============================================================
// Google Doc URL Parsing
// ============================================================

/**
 * Extract the Google Doc ID from a variety of Google Docs URL formats.
 *
 * Supported formats:
 * - https://docs.google.com/document/d/DOC_ID/edit
 * - https://docs.google.com/document/d/DOC_ID/pub
 * - https://docs.google.com/document/d/DOC_ID
 *
 * Returns null if the URL doesn't look like a Google Doc.
 */
export function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

/**
 * Validate that a string is a genuine, browser-safe Google Docs URL.
 *
 * `extractDocId` alone is NOT a safety check: its regex matches any string
 * that merely *contains* `/document/d/<id>` — including hostile schemes such
 * as `javascript:alert(1)//x/document/d/abc`. Because bill URLs are rendered
 * into an <a href> on the web, we must parse the URL and pin both the scheme
 * (https) and host (docs.google.com) before trusting it.
 */
export function isValidGoogleDocUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'docs.google.com' && !host.endsWith('.docs.google.com')) {
    return false;
  }
  return extractDocId(url) !== null;
}

// ============================================================
// Content Fetching (stub)
// ============================================================

/**
 * Fetch the text content of a Google Doc by its document ID.
 *
 * Currently a stub — returns a placeholder message.
 * Will be replaced with a real Google Docs API call (read-only
 * via service account) or a published-to-web scrape.
 */
export async function fetchDocContent(docId: string): Promise<string> {
  // TODO: Implement real Google Docs API fetch
  // Options:
  //   1. Google Docs API with service account (preferred)
  //   2. Scrape the /pub endpoint if the doc is published
  //   3. Fall back to prompting the author to paste content
  return `[Google Doc content placeholder — doc ID: ${docId}. Content fetching will be implemented with Google Docs API integration.]`;
}

// ============================================================
// Caching
// ============================================================

/**
 * Fetch content from the Google Doc linked to a bill and
 * store it in the `cachedContent` field.
 *
 * Returns the cached content string, or null if the bill
 * has no googleDocId set.
 */
export async function cacheDocContent(
  db: Database,
  billId: string,
): Promise<string | null> {
  const [bill] = await db
    .select({ googleDocId: bills.googleDocId })
    .from(bills)
    .where(eq(bills.id, billId))
    .limit(1);

  if (!bill?.googleDocId) return null;

  const content = await fetchDocContent(bill.googleDocId);

  await db
    .update(bills)
    .set({
      cachedContent: content,
      cachedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bills.id, billId));

  return content;
}
