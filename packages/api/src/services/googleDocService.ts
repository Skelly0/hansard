import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills } from '@hansard/db';

// ============================================================
// Google Doc URL Parsing
// ============================================================

// Matches the doc-id segment of a Google Docs *path*, covering the shapes
// Google actually produces:
//   /document/d/<id>              standard
//   /document/u/0/d/<id>          multi-account session
//   /document/d/e/<published-id>  published-to-web (.../pub)
// The `(?:u\/\d+\/)?` and `(?:e\/)?` groups are skipped so the captured id is
// the real document id, never the literal `e` of a published link.
const DOC_PATH_RE = /\/document\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]+)/;
const DOC_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Extract the Google Doc ID from a variety of Google Docs URL formats.
 *
 * Supported formats:
 * - https://docs.google.com/document/d/DOC_ID/edit
 * - https://docs.google.com/document/u/0/d/DOC_ID/edit  (multi-account)
 * - https://docs.google.com/document/d/e/DOC_ID/pub     (published)
 * - https://docs.google.com/open?id=DOC_ID              (Drive open link)
 *
 * The id is read from the URL's *path* (or the `id` query param), never from
 * the raw string, so a `/document/d/<id>` fragment hidden in a query or after
 * a hostile scheme does not leak a bogus id. Returns null if the URL doesn't
 * look like a Google Doc.
 */
export function extractDocId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fromPath = parsed.pathname.match(DOC_PATH_RE);
    if (fromPath) return fromPath[1];
    const idParam = parsed.searchParams.get('id');
    if (idParam && DOC_ID_RE.test(idParam)) return idParam;
    return null;
  } catch {
    // Not an absolute URL (e.g. a bare path from legacy/migration data) —
    // scan the path shape only, never a query string.
    const fromPath = url.match(DOC_PATH_RE);
    return fromPath ? fromPath[1] : null;
  }
}

/**
 * Validate that a string is a genuine, browser-safe Google Docs URL.
 *
 * `extractDocId` alone is NOT a safety check: a `/document/d/<id>` segment can
 * appear inside a hostile scheme such as `javascript:alert(1)//x/document/d/abc`
 * or a query string. Because bill URLs are rendered into an <a href> on the
 * web, we parse the URL and pin both the scheme (https) and host
 * (exactly docs.google.com) before trusting it.
 */
export function isValidGoogleDocUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname.toLowerCase() !== 'docs.google.com') return false;
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
