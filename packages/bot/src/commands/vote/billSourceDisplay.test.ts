import { describe, expect, it, vi } from 'vitest';
import { buildLinkedBillSourceDisplay } from './billSourceDisplay.js';

function makeDb(...resultSets: unknown[][]) {
  const limit = vi.fn();
  for (const rows of resultSets) {
    limit.mockResolvedValueOnce(rows);
  }
  limit.mockResolvedValue([]);
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
    const { db } = makeDb(
      [{
        title: 'Bridge Security Act',
        billNumber: 7,
        authorId: 'author-1',
        billType: 'google_doc',
        googleDocUrl: 'https://docs.google.com/document/d/example/edit',
        cachedContent: null,
      }],
      [{ characterName: 'Eleanor Vance', discordId: '111222333' }],
    );

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.embeds).toEqual([]);
    expect(display.fields).toEqual([
      { name: 'Author', value: 'Eleanor Vance (<@111222333>)', inline: true },
      {
        name: 'Bill Text',
        value: '[Google Doc](https://docs.google.com/document/d/example/edit)',
        inline: false,
      },
    ]);
  });

  it('returns full short bill text embeds for linked short bills', async () => {
    const billText = 'Section 1. Establishes bridge patrols.\n\nSection 2. Takes effect immediately.';
    const { db } = makeDb(
      [{
        title: 'Bridge Security Act',
        billNumber: 7,
        authorId: 'author-1',
        billType: 'short',
        googleDocUrl: null,
        cachedContent: billText,
      }],
      [{ characterName: 'Eleanor Vance', discordId: '111222333' }],
    );

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.fields).toEqual([
      { name: 'Author', value: 'Eleanor Vance (<@111222333>)', inline: true },
      { name: 'Bill Text', value: 'Short bill text below.', inline: false },
    ]);
    expect(display.embeds.map((embed) => embed.data.description).join('')).toBe(billText);
  });

  it('falls back to Unknown when the bill author cannot be resolved', async () => {
    const { db } = makeDb(
      [{
        title: 'Orphan Act',
        billNumber: 9,
        authorId: 'missing-author',
        billType: 'google_doc',
        googleDocUrl: 'https://docs.google.com/document/d/orphan/edit',
        cachedContent: null,
      }],
      [],
    );

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.fields[0]).toEqual({ name: 'Author', value: 'Unknown', inline: true });
  });

  it('renders the author name without a mention when no Discord account is linked', async () => {
    const { db } = makeDb(
      [{
        title: 'Bridge Security Act',
        billNumber: 7,
        authorId: 'author-1',
        billType: 'google_doc',
        googleDocUrl: 'https://docs.google.com/document/d/example/edit',
        cachedContent: null,
      }],
      [{ characterName: 'Eleanor Vance', discordId: null }],
    );

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    });

    expect(display.fields[0]).toEqual({ name: 'Author', value: 'Eleanor Vance', inline: true });
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

  it('does not query bills for standalone legislative votes', async () => {
    const { db, select } = makeDb([]);

    const display = await buildLinkedBillSourceDisplay(db, {
      type: 'legislative_vote',
      relatedBillId: null,
    });

    expect(display).toEqual({ fields: [], embeds: [] });
    expect(select).not.toHaveBeenCalled();
  });
});
