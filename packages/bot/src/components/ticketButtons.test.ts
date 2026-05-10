import { describe, expect, it, vi } from 'vitest';
import { buildTicketSummaryEmbed } from './ticketButtons.js';

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
});
