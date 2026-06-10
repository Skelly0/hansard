import { describe, expect, it } from 'vitest';
import { extractDocId, isValidGoogleDocUrl } from './googleDocService.js';

describe('extractDocId', () => {
  it('pulls the id out of standard Google Docs URLs', () => {
    expect(extractDocId('https://docs.google.com/document/d/abc123_DEF/edit')).toBe('abc123_DEF');
    expect(extractDocId('https://docs.google.com/document/d/xyz/pub')).toBe('xyz');
  });

  it('returns null when there is no /document/d/ segment', () => {
    expect(extractDocId('https://example.com/foo')).toBeNull();
  });

  it('reads the id from multi-account, published, and Drive-open shapes', () => {
    // Multi-account session URL (/u/<n>/d/) — the digit segment is skipped.
    expect(extractDocId('https://docs.google.com/document/u/0/d/ABC123/edit')).toBe('ABC123');
    // Published-to-web URL (/d/e/<id>/pub) — captures the real id, not the 'e'.
    expect(extractDocId('https://docs.google.com/document/d/e/2PACX-XYZ/pub')).toBe('2PACX-XYZ');
    // Drive open link carries the id in the query string.
    expect(extractDocId('https://docs.google.com/open?id=ABC123')).toBe('ABC123');
  });

  it('does not read an id from a /document/d/ fragment hidden in the query', () => {
    expect(extractDocId('https://docs.google.com/?x=/document/d/FAKEID')).toBeNull();
    expect(extractDocId('https://docs.google.com/?id=/document/d/FAKEID')).toBeNull();
  });

  // extractDocId is NOT a safety check: the doc path can still be pulled from a
  // hostile scheme's opaque body, which is exactly why isValidGoogleDocUrl pins
  // the scheme and host on top of it.
  it('still finds the path in a javascript: payload (so isValidGoogleDocUrl must gate it)', () => {
    expect(extractDocId('javascript:alert(1)//x/document/d/abc')).toBe('abc');
  });
});

describe('isValidGoogleDocUrl', () => {
  it('accepts genuine https Google Docs URLs', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true);
    expect(isValidGoogleDocUrl('https://docs.google.com/document/d/abc123')).toBe(true);
  });

  it('accepts the real-world multi-account, published, and Drive-open shapes', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com/document/u/0/d/ABC123/edit')).toBe(true);
    expect(isValidGoogleDocUrl('https://docs.google.com/document/d/e/2PACX-XYZ/pub')).toBe(true);
    expect(isValidGoogleDocUrl('https://docs.google.com/open?id=ABC123')).toBe(true);
  });

  it('rejects a docs.google.com URL whose only doc path is in the query string', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com/?x=/document/d/FAKEID')).toBe(false);
  });

  it('rejects a userinfo trick that points the real host elsewhere', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com@evil.test/document/d/abc')).toBe(false);
  });

  it('rejects the javascript: payload that fools extractDocId', () => {
    expect(isValidGoogleDocUrl('javascript:alert(1)//x/document/d/abc')).toBe(false);
  });

  it('rejects non-https schemes', () => {
    expect(isValidGoogleDocUrl('http://docs.google.com/document/d/abc/edit')).toBe(false);
    expect(isValidGoogleDocUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects look-alike and unrelated hosts', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com.evil.test/document/d/abc')).toBe(false);
    expect(isValidGoogleDocUrl('https://evil.test/document/d/abc')).toBe(false);
  });

  it('rejects Google Docs hosts without a document id', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com/spreadsheets/d/abc')).toBe(false);
  });

  it('rejects unparseable garbage', () => {
    expect(isValidGoogleDocUrl('not a url')).toBe(false);
    expect(isValidGoogleDocUrl('')).toBe(false);
  });
});
