/**
 * Return true only for URLs safe to place in an <a href>.
 *
 * Guards against `javascript:`, `data:`, and other active schemes that would
 * execute in the viewer's session when clicked. User-supplied URLs (e.g. a
 * bill's Google Doc link) must pass through this before being rendered as a
 * link — the backend validates new submissions, but legacy rows predate that
 * check, so the render sink is the universal backstop.
 */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

/**
 * Return true only for safe http(s) URLs whose host is exactly docs.google.com.
 *
 * `isSafeHttpUrl` blocks active schemes but not hosts, so a stored
 * `https://evil.example/...` would otherwise render behind an "Open in Google
 * Docs" label — a phishing-shaped link. Use this when the link is presented as
 * a Google Docs link so the host matches the claim.
 */
export function isGoogleDocsHttpUrl(url: string | null | undefined): url is string {
  if (!isSafeHttpUrl(url)) return false;
  try {
    return new URL(url).hostname.toLowerCase() === 'docs.google.com';
  } catch {
    return false;
  }
}
