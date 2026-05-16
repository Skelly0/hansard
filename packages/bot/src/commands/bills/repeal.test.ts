import { describe, expect, it } from 'vitest';
import { BillStatus } from '@hansard/shared';
import {
  buildRepealEditEmbed,
  buildRepealFallbackEmbed,
  type RepealEmbedInput,
} from './repealEmbeds.js';

const baseBill = {
  id: 'bill-1',
  title: 'A Repealable Bill',
  shortTitle: null,
  slug: 'a-repealable-bill',
  billNumber: 12,
  billType: 'google_doc' as const,
  googleDocUrl: 'https://docs.google.com/document/d/abc/edit',
  googleDocId: 'abc',
  cachedContent: null,
  cachedAt: null,
  summary: 'A short summary.',
  authorId: 'author-1',
  submittedById: 'author-1',
  coSponsorIds: [],
  status: BillStatus.ENACTED,
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  playerVoteId: null,
  playerVoteResult: null,
  playerVoteAt: null,
  npcVoteRequired: false,
  npcVote: null,
  enactedAt: new Date('2026-02-01T00:00:00Z'),
  effectiveAt: new Date('2026-02-01T00:00:00Z'),
  repealedAt: null,
  repealedByBillId: null,
  legislationChannelId: 'chan-1',
  legislationMessageId: 'msg-1',
  collectionId: null,
  parentDocumentId: null,
  amendsBillId: null,
  amendsDocumentId: null,
  tags: ['economy'],
  policyAreas: ['fiscal'],
  crossReferences: [],
  estimatedEffects: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
} as unknown as RepealEmbedInput['bill'];

const baseInput: RepealEmbedInput = {
  bill: baseBill,
  authorDisplay: 'Jane Doe (<@123>)',
  previousStatus: BillStatus.ENACTED,
  actorDiscordId: '999',
  now: new Date('2026-03-01T00:00:00Z'),
};

describe('buildRepealEditEmbed', () => {
  it('produces a strikethrough enactment line, keeps the doc link, and prefixes a 🚫 marker on the title', () => {
    const embed = buildRepealEditEmbed(baseInput).toJSON();

    expect(embed.title).toMatch(/\u{1F6AB} \[REPEALED\] /u);
    expect(embed.title).toContain(baseBill.title);
    expect(embed.url).toBe(baseBill.googleDocUrl);
    expect(embed.description ?? '').toMatch(/This law has been repealed/);
    expect(embed.description ?? '').toMatch(/~~\*\*Bill #B-012\*\* was enacted as law/);
    expect(embed.description ?? '').toContain('Repealed by <@999>');
    expect(embed.description ?? '').toContain(baseBill.googleDocUrl!);

    const fieldNames = (embed.fields ?? []).map((f) => f.name);
    expect(fieldNames).toContain('Author');
    expect(fieldNames).toContain('Status');
    expect(fieldNames).toContain('Tags');
    expect(fieldNames).toContain('Policy Areas');
  });

  it('omits the enactment date when bill.enactedAt is null', () => {
    const embed = buildRepealEditEmbed({
      ...baseInput,
      bill: { ...baseBill, enactedAt: null },
    }).toJSON();

    expect(embed.description ?? '').toMatch(/~~\*\*Bill #B-012\*\* was enacted as law\./);
    expect(embed.description ?? '').not.toMatch(/<t:\d+:F>~~/);
  });
});

describe('buildRepealFallbackEmbed', () => {
  it('produces a fresh "repealed" announcement embed without a strikethrough banner', () => {
    const embed = buildRepealFallbackEmbed(baseInput).toJSON();

    expect(embed.title).toContain(baseBill.title);
    expect(embed.title).not.toMatch(/REPEALED/);
    expect(embed.url).toBe(baseBill.googleDocUrl);
    expect(embed.description ?? '').toMatch(/has been \*\*repealed\*\* and is no longer law/);
    expect(embed.description ?? '').not.toMatch(/~~/);
    expect(embed.description ?? '').toContain('Repealed by <@999>');

    const previousStatus = (embed.fields ?? []).find((f) => f.name === 'Previous status');
    expect(previousStatus?.value).toBe(`\`${BillStatus.ENACTED}\``);
  });
});
