import { describe, expect, it, vi } from 'vitest';
import {
  fetchDiscordThreadMessages,
  selectBackfillCandidates,
} from './backfillTicketThreadMessages';

describe('selectBackfillCandidates', () => {
  it('keeps only unmigrated human text messages from known ticket threads', () => {
    const ticket = {
      id: 'ticket-1',
      number: 42,
      title: 'Missing thread messages',
      createdById: 'creator-player',
      assignedToId: null,
      discordThreadId: 'thread-42',
      firstResponseAt: null,
      updatedAt: new Date('2026-05-20T10:00:00.000Z'),
    };

    const result = selectBackfillCandidates({
      tickets: [ticket],
      messagesByThreadId: new Map([
        ['thread-42', [
          {
            id: 'msg-bot',
            content: 'Ticket summary',
            timestamp: '2026-05-20T10:01:00.000Z',
            author: { id: 'bot-user', bot: true },
          },
          {
            id: 'msg-existing',
            content: 'Already recorded',
            timestamp: '2026-05-20T10:02:00.000Z',
            author: { id: 'staff-discord', bot: false },
          },
          {
            id: 'msg-empty',
            content: '   ',
            timestamp: '2026-05-20T10:03:00.000Z',
            author: { id: 'staff-discord', bot: false },
          },
          {
            id: 'msg-attachment',
            content: '',
            timestamp: '2026-05-20T10:04:30.000Z',
            author: { id: 'staff-discord', bot: false },
            attachments: [
              { filename: 'evidence.png', url: 'https://cdn.discordapp.com/evidence.png' },
            ],
          },
          {
            id: 'msg-unmapped',
            content: 'No player row',
            timestamp: '2026-05-20T10:04:00.000Z',
            author: { id: 'ghost-discord', bot: false },
          },
          {
            id: 'msg-sticker',
            content: '',
            timestamp: '2026-05-20T10:04:45.000Z',
            author: { id: 'staff-discord', bot: false },
            sticker_items: [
              { name: 'thumbs up' },
            ],
          },
          {
            id: 'msg-late',
            content: 'Second missed reply',
            timestamp: '2026-05-20T10:06:00.000Z',
            author: { id: 'staff-discord', bot: false },
          },
          {
            id: 'msg-early',
            content: 'First missed reply',
            timestamp: '2026-05-20T10:05:00.000Z',
            author: { id: 'staff-discord', bot: false },
          },
        ]],
      ]),
      existingDiscordMessageIds: new Set(['msg-existing']),
      playersByDiscordId: new Map([
        ['staff-discord', { id: 'staff-player', discordId: 'staff-discord' }],
      ]),
    });

    expect(result.candidates.map((candidate) => candidate.discordMessageId)).toEqual([
      'msg-attachment',
      'msg-sticker',
      'msg-early',
      'msg-late',
    ]);
    expect(result.candidates[0]).toMatchObject({
      ticketId: 'ticket-1',
      ticketNumber: 42,
      authorPlayerId: 'staff-player',
      content: '**Attachments:**\n- evidence.png: https://cdn.discordapp.com/evidence.png',
    });
    expect(result.skipped).toEqual({
      bot: 1,
      empty: 1,
      existing: 1,
      invalidTimestamp: 0,
      unmappedAuthor: 1,
      unsupportedType: 0,
    });
  });
});

describe('fetchDiscordThreadMessages', () => {
  it('paginates Discord history and returns messages in chronological order', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `newer-${index}`,
      content: `newer ${index}`,
      timestamp: new Date(Date.UTC(2026, 4, 20, 10, 0, index)).toISOString(),
      author: { id: 'staff-discord', bot: false },
    }));
    const oldestFromFirstPage = firstPage[99].id;
    const secondPage = [{
      id: 'oldest',
      content: 'oldest',
      timestamp: '2026-05-20T09:00:00.000Z',
      author: { id: 'staff-discord', bot: false },
    }];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(firstPage),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(secondPage),
      });

    const messages = await fetchDiscordThreadMessages({
      threadId: 'thread-42',
      token: 'bot-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toContain(`before=${oldestFromFirstPage}`);
    expect(messages[0].id).toBe('oldest');
    expect(messages.at(-1)?.id).toBe('newer-99');
  });
});
