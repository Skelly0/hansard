import { describe, expect, it, vi } from 'vitest';
import { buildLinkedBillSourceDisplay } from './billSourceDisplay.js';

function makeDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as any,
    select,
  };
}

describe('buildLinkedBillSourceDisplay', () => {
  it('returns a Google Doc field for linked Google Doc bills', async () => {
    const { db } = makeDb([{
      title: 'Bridge Security Act',
      billNumber: 7,
      billType: 'google_doc',
      googleDocUrl: 'https://docs.google.com/document/d/example/edit',
      cachedContent: null,
    }]);

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.embeds).toEqual([]);
    expect(display.fields).toEqual([
      {
        name: 'Bill Text',
        value: '[Google Doc](https://docs.google.com/document/d/example/edit)',
        inline: false,
      },
    ]);
  });

  it('returns full short bill text embeds for linked short bills', async () => {
    const billText = 'Section 1. Establishes bridge patrols.\n\nSection 2. Takes effect immediately.';
    const { db } = makeDb([{
      title: 'Bridge Security Act',
      billNumber: 7,
      billType: 'short',
      googleDocUrl: null,
      cachedContent: billText,
    }]);

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.fields).toEqual([
      { name: 'Bill Text', value: 'Short bill text below.', inline: false },
    ]);
    expect(display.embeds.map((embed) => embed.data.description).join('')).toBe(billText);
  });

  it('does not query bills for unrelated election types', async () => {
    const { db, select } = makeDb([]);

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'referendum',
      relatedBillId: 'bill-1',
    });

    expect(display).toEqual({ fields: [], embeds: [] });
    expect(select).not.toHaveBeenCalled();
  });
});
