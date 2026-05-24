import { describe, expect, it, vi } from 'vitest';
import {
  formatTicketThreadMirrorContent,
  selectMissingThreadMirrors,
  sendDiscordThreadMessage,
} from './backfillTicketThreadMirrors';

const ticket = {
  id: 'ticket-175',
  number: 175,
  title: 'Tapping the Com Net',
  description: 'Opening ticket body',
  createdAt: new Date('2026-05-24T16:25:26.926Z'),
  discordThreadId: 'thread-175',
};

const creator = {
  id: 'creator-player',
  characterName: 'Klara Vogt',
  discordUsername: 'klara',
};

const staff = {
  id: 'staff-player',
  characterName: 'Moonmouth (Skelly)',
  discordUsername: 'skelly',
};

describe('formatTicketThreadMirrorContent', () => {
  it('matches the live TicketService mirror format for public replies', () => {
    expect(formatTicketThreadMirrorContent({
      author: creator,
      content: 'Please tap Ayer.',
      isInternal: false,
    })).toBe('💬 **Klara Vogt** replied:\nPlease tap Ayer.');
  });

  it('matches the live TicketService mirror format for internal notes', () => {
    expect(formatTicketThreadMirrorContent({
      author: staff,
      content: 'Staff-only context',
      isInternal: true,
    })).toBe('🔒 **Moonmouth (Skelly)** (internal note):\nStaff-only context');
  });
});

describe('sendDiscordThreadMessage', () => {
  it('temporarily unarchives archived threads before retrying a failed mirror post', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"Missing Access"}', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: true } }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: false } }))
      .mockResolvedValueOnce(Response.json({ id: 'discord-message' }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: true } }));

    await sendDiscordThreadMessage({
      threadId: 'thread-175',
      token: 'bot-token',
      content: 'hello',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bot bot-token' },
    });
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    });
    expect(fetchImpl.mock.calls[3][1]).toMatchObject({ method: 'POST' });
    expect(fetchImpl.mock.calls[4][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
  });

  it('honours Discord rate-limit retries while toggling archived threads', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"Missing Access"}', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: true } }))
      .mockResolvedValueOnce(new Response('{"retry_after":0}', { status: 429 }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: false } }))
      .mockResolvedValueOnce(Response.json({ id: 'discord-message' }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: true } }));

    await sendDiscordThreadMessage({
      threadId: 'thread-175',
      token: 'bot-token',
      content: 'hello',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    });
    expect(fetchImpl.mock.calls[3][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    });
  });

  it('reports archive restore failures after the mirror message has been posted', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"Missing Access"}', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: true } }))
      .mockResolvedValueOnce(Response.json({ thread_metadata: { archived: false } }))
      .mockResolvedValueOnce(Response.json({ id: 'discord-message' }))
      .mockResolvedValueOnce(new Response('{"message":"restore failed"}', { status: 500 }));

    const result = await sendDiscordThreadMessage({
      threadId: 'thread-175',
      token: 'bot-token',
      content: 'hello',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      postedChunks: 1,
      archiveRestoreFailed: true,
    });
  });
});

describe('selectMissingThreadMirrors', () => {
  it('selects saved player replies that are absent from the Discord thread', () => {
    const result = selectMissingThreadMirrors({
      ticket,
      dbMessages: [
        {
          id: 'opening-message',
          ticketId: ticket.id,
          content: 'Opening ticket body',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:25:26.926Z'),
          author: creator,
        },
        {
          id: 'mirrored-staff',
          ticketId: ticket.id,
          content: 'Yes, that works.',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:32:41.047Z'),
          author: staff,
        },
        {
          id: 'missing-player',
          ticketId: ticket.id,
          content: 'What is the chance of discovery?',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:34:50.638Z'),
          author: creator,
        },
        {
          id: 'thread-origin',
          ticketId: ticket.id,
          content: 'I typed this in the staff thread.',
          isInternal: false,
          discordMessageId: 'discord-message-id',
          createdAt: new Date('2026-05-24T16:50:00.700Z'),
          author: staff,
        },
      ],
      discordMessages: [
        {
          id: 'mirrored-staff-discord',
          content: '💬 **Moonmouth (Skelly)** replied:\nYes, that works.',
          timestamp: '2026-05-24T16:32:41.979Z',
          author: { id: 'bot-user', bot: true },
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.messageId)).toEqual(['missing-player']);
    expect(result.skipped).toEqual({
      alreadyMirrored: 1,
      empty: 0,
      openingMessage: 1,
      threadOrigin: 1,
    });
  });

  it('treats Discord-trimmed trailing whitespace as already mirrored', () => {
    const result = selectMissingThreadMirrors({
      ticket,
      dbMessages: [
        {
          id: 'trimmed-player',
          ticketId: ticket.id,
          content: 'I \n',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:37:45.934Z'),
          author: creator,
        },
      ],
      discordMessages: [
        {
          id: 'trimmed-discord',
          content: '💬 **Klara Vogt** replied:\nI',
          timestamp: '2026-05-24T16:37:46.500Z',
          author: { id: 'bot-user', bot: true },
        },
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped.alreadyMirrored).toBe(1);
  });

  it('requires every split chunk to be present before skipping a long mirror', () => {
    const longContent = `${'a'.repeat(1995)}\n\n${'b'.repeat(20)}`;
    const result = selectMissingThreadMirrors({
      ticket,
      dbMessages: [
        {
          id: 'partial-long-player',
          ticketId: ticket.id,
          content: longContent,
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:40:00.000Z'),
          author: creator,
        },
      ],
      discordMessages: [
        {
          id: 'first-chunk-only',
          content: `💬 **Klara Vogt** replied:\n${'a'.repeat(1995)}`,
          timestamp: '2026-05-24T16:40:01.000Z',
          author: { id: 'bot-user', bot: true },
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.messageId)).toEqual(['partial-long-player']);
    expect(result.skipped.alreadyMirrored).toBe(0);
  });

  it('keeps a duplicate rendered reply missing when Discord only has one copy', () => {
    const result = selectMissingThreadMirrors({
      ticket,
      dbMessages: [
        {
          id: 'duplicate-one',
          ticketId: ticket.id,
          content: 'Same answer',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:40:00.000Z'),
          author: creator,
        },
        {
          id: 'duplicate-two',
          ticketId: ticket.id,
          content: 'Same answer',
          isInternal: false,
          discordMessageId: null,
          createdAt: new Date('2026-05-24T16:41:00.000Z'),
          author: creator,
        },
      ],
      discordMessages: [
        {
          id: 'one-copy-discord',
          content: '💬 **Klara Vogt** replied:\nSame answer',
          timestamp: '2026-05-24T16:40:01.000Z',
          author: { id: 'bot-user', bot: true },
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.messageId)).toEqual(['duplicate-two']);
    expect(result.skipped.alreadyMirrored).toBe(1);
  });
});
