import { describe, expect, it, vi } from 'vitest';
import {
  TICKET_DESCRIPTION_PAGE_SIZE,
  buildTicketDescriptionEmbeds,
  buildTicketOpeningMessages,
  buildTicketSummaryEmbed,
  buildTicketSummaryEmbeds,
} from './ticketButtons.js';

vi.mock('../db.js', () => ({ db: {} }));

describe('buildTicketSummaryEmbed', () => {
  it('keeps the full ticket description in the summary embed', () => {
    const description = [
      'A'.repeat(401),
      'This final sentence should still be visible.',
    ].join('\n');

    const embed = buildTicketSummaryEmbed({
      number: 42,
      title: 'Long petition',
      description,
      category: { name: 'Appeals', emoji: 'A' },
      status: 'open',
      priority: 'normal',
      createdBy: { id: 'player-1', displayName: 'Ada' },
      assignedTo: null,
      createdAt: '2026-05-01T12:00:00.000Z',
      tags: [],
    });

    expect(embed.data.description).toBe(description);
  });

  it('splits long ticket descriptions into Discord-safe summary pages', () => {
    const description = `${'A'.repeat(TICKET_DESCRIPTION_PAGE_SIZE)}${'B'.repeat(50)}`;

    const pages = buildTicketSummaryEmbeds({
      number: 42,
      title: 'Long petition',
      description,
      category: { name: 'Appeals', emoji: 'A' },
      status: 'open',
      priority: 'normal',
      createdBy: { id: 'player-1', displayName: 'Ada' },
      assignedTo: null,
      createdAt: '2026-05-01T12:00:00.000Z',
      tags: [],
    });

    expect(pages).toHaveLength(2);
    expect(pages.every((page) => (page.data.description?.length ?? 0) <= TICKET_DESCRIPTION_PAGE_SIZE)).toBe(true);
    expect(pages.map((page) => page.data.description).join('')).toBe(description);
    expect(pages[0].data.fields).toBeDefined();
    expect(pages[1].data.fields).toBeUndefined();
    expect(pages[1].data.title).toContain('continued');
  });
});

describe('buildTicketDescriptionEmbeds', () => {
  it('keeps metadata fields only on the first ticket page', () => {
    const pages = buildTicketDescriptionEmbeds({
      title: 'Ticket #42: Long petition',
      description: `${'A'.repeat(TICKET_DESCRIPTION_PAGE_SIZE)}${'B'.repeat(50)}`,
      fields: [{ name: 'Status', value: 'Open', inline: true }],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].data.fields).toHaveLength(1);
    expect(pages[1].data.fields).toBeUndefined();
  });
});

describe('buildTicketOpeningMessages', () => {
  it('splits the thread opening message into Discord-safe chunks', () => {
    const messages = buildTicketOpeningMessages('Ada', `${'A'.repeat(1990)}${'B'.repeat(50)}`);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 2000)).toBe(true);
    expect(messages.join('').replace('**Ada** opened this ticket:\n\n', '')).toBe(`${'A'.repeat(1990)}${'B'.repeat(50)}`);
    expect(messages[0]).toMatch(/^\*\*Ada\*\* opened this ticket:/);
  });
});
