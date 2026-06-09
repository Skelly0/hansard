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

  // The vulnerability that motivated isValidGoogleDocUrl: extractDocId's regex
  // matches a /document/d/ segment ANYWHERE in the string, so it alone cannot
  // reject hostile schemes.
  it('is fooled by a javascript: payload that embeds the doc path', () => {
    expect(extractDocId('javascript:alert(1)//x/document/d/abc')).toBe('abc');
  });
});

describe('isValidGoogleDocUrl', () => {
  it('accepts genuine https Google Docs URLs', () => {
    expect(isValidGoogleDocUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true);
    expect(isValidGoogleDocUrl('https://docs.google.com/document/d/abc123')).toBe(true);
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
