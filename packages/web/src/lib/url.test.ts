import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl, isGoogleDocsHttpUrl } from './url';

describe('isSafeHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeHttpUrl('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects active/script schemes that would execute on click', () => {
    expect(isSafeHttpUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects empty / nullish / unparseable values', () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });
});

describe('isGoogleDocsHttpUrl', () => {
  it('accepts safe URLs whose host is exactly docs.google.com', () => {
    expect(isGoogleDocsHttpUrl('https://docs.google.com/document/d/abc/edit')).toBe(true);
  });

  it('rejects other hosts that would render behind the "Open in Google Docs" label', () => {
    // The phishing vector: a safe https scheme but a non-Google host.
    expect(isGoogleDocsHttpUrl('https://evil.example/login')).toBe(false);
    expect(isGoogleDocsHttpUrl('https://docs.google.com.evil.test/document/d/abc')).toBe(false);
    expect(isGoogleDocsHttpUrl('https://docs.google.com@evil.test/document/d/abc')).toBe(false);
  });

  it('rejects active schemes and nullish values just like isSafeHttpUrl', () => {
    expect(isGoogleDocsHttpUrl('javascript:alert(1)//docs.google.com')).toBe(false);
    expect(isGoogleDocsHttpUrl(null)).toBe(false);
    expect(isGoogleDocsHttpUrl(undefined)).toBe(false);
  });
});
