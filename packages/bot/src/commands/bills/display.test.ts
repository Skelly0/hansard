import { describe, expect, it } from 'vitest';
import { splitBillTextForDiscord, buildShortBillContentPages } from './display.js';

describe('short bill display helpers', () => {
  it('splits long bill text into Discord-safe chunks', () => {
    const text = `${'A'.repeat(1800)}${'B'.repeat(1800)}${'C'.repeat(250)}`;

    const chunks = splitBillTextForDiscord(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1800)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('prefers paragraph breaks when splitting short bill text', () => {
    const chunks = splitBillTextForDiscord(`${'A'.repeat(900)}\n\n${'B'.repeat(900)}`, 1000);

    expect(chunks).toEqual(['A'.repeat(900), 'B'.repeat(900)]);
  });

  it('keeps metadata fields only on the first short bill page', () => {
    const pages = buildShortBillContentPages({
      title: 'Public Parks Act',
      content: `${'A'.repeat(1800)}${'B'.repeat(100)}`,
      fields: [{ name: 'Bill Number', value: '`#1`', inline: true }],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].data.fields).toHaveLength(1);
    expect(pages[1].data.fields).toBeUndefined();
    expect(pages[1].data.title).toContain('continued');
  });
});
