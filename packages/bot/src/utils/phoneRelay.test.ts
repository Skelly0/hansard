import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const { __internal } = await import('./phoneRelay.js');

describe('phoneRelay.chunkText', () => {
  it('returns the input unchanged when it fits within the budget', () => {
    expect(__internal.chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits long text on a newline when possible', () => {
    const text = 'a'.repeat(50) + '\n' + 'b'.repeat(50);
    const chunks = __internal.chunkText(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(60);
  });

  it('splits on a space when no newline is available within the budget', () => {
    const text = 'word '.repeat(100); // 500 chars total
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    // No chunk should end mid-word.
    for (const c of chunks.slice(0, -1)) {
      expect(/\w$/.test(c)).toBe(true);
    }
  });

  it('falls back to a hard split when no word/newline boundary exists in budget', () => {
    const text = 'x'.repeat(500);
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it('preserves the full content across chunks', () => {
    const text = 'a'.repeat(250);
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.join('').length).toBe(text.length);
  });
});

describe('phoneRelay tap mirror channel validation', () => {
  const guild = { id: 'G1', roles: { everyone: { id: 'G1' } } };
  const makeChannel = (everyoneCanView: boolean) => ({
    id: 'C1',
    type: 0,
    guild,
    permissionsFor: () => ({
      has: (perm: string) => perm === 'ViewChannel' && everyoneCanView,
    }),
  });

  it('refuses a public env fallback tap channel before delivery', () => {
    expect(__internal.validateTapMirrorChannel(makeChannel(true) as never)).toMatch(/must be private/i);
  });

  it('allows a private env fallback tap channel', () => {
    expect(__internal.validateTapMirrorChannel(makeChannel(false) as never)).toBeNull();
  });
});
