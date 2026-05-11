import { describe, expect, it, vi } from 'vitest';
import {
  exportDiscordMessages,
  formatMessageExportMarkdown,
  parseMessageExportChannelIds,
} from './messageExportService';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function discordMessage(input: {
  id: string;
  channelId?: string;
  authorId?: string;
  authorName?: string;
  authorBot?: boolean;
  timestamp: string;
  content?: string;
  attachments?: unknown[];
  embeds?: unknown[];
}) {
  return {
    id: input.id,
    channel_id: input.channelId ?? 'channel-1',
    author: {
      id: input.authorId ?? `author-${input.id}`,
      username: input.authorName ?? `Author ${input.id}`,
      bot: input.authorBot ?? false,
    },
    timestamp: input.timestamp,
    content: input.content ?? `content ${input.id}`,
    attachments: input.attachments ?? [],
    embeds: input.embeds ?? [],
  };
}

describe('message export service', () => {
  it('exports the last 24 hours oldest-first with attachment and embed metadata', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        return jsonResponse([
          discordMessage({
            id: 'newer',
            timestamp: '2026-05-11T11:00:00.000Z',
            content: 'newer event',
            embeds: [{ title: 'Vote opened', url: 'https://example.test/vote', description: 'A vote began.' }],
          }),
          discordMessage({
            id: 'older',
            timestamp: '2026-05-11T10:00:00.000Z',
            content: 'older event',
            attachments: [{
              filename: 'minutes.txt',
              url: 'https://cdn.example.test/minutes.txt',
              content_type: 'text/plain',
              size: 512,
            }],
          }),
          discordMessage({
            id: 'too-old',
            timestamp: '2026-05-10T11:59:59.000Z',
            content: 'outside the window',
          }),
        ]);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      hours: 24,
      maxMessages: 100,
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(result.window).toEqual({
      start: '2026-05-10T12:00:00.000Z',
      end: '2026-05-11T12:00:00.000Z',
      hours: 24,
    });
    expect(result.messages.map((message) => message.id)).toEqual(['older', 'newer']);
    expect(result.messages[0]).toMatchObject({
      channelId: 'channel-1',
      channelName: 'general',
      authorId: 'author-older',
      authorName: 'Author older',
      authorIsBot: false,
      content: 'older event',
      attachments: [{
        filename: 'minutes.txt',
        url: 'https://cdn.example.test/minutes.txt',
        contentType: 'text/plain',
        size: 512,
      }],
    });
    expect(result.messages[1].embeds).toEqual([{
      title: 'Vote opened',
      url: 'https://example.test/vote',
      description: 'A vote began.',
    }]);
    expect(result.channels).toEqual([{
      id: 'channel-1',
      name: 'general',
      status: 'ok',
      messageCount: 2,
    }]);
    expect(result.truncated).toBe(false);
  });

  it('exports messages from active and archived threads under an allowlisted parent channel', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/parent-1') {
        return jsonResponse({ id: 'parent-1', guild_id: 'guild-1', name: 'general', type: 0 });
      }
      if (text === 'https://discord.com/api/v10/channels/parent-1/messages?limit=100') {
        return jsonResponse([]);
      }
      if (text === 'https://discord.com/api/v10/guilds/guild-1/threads/active') {
        return jsonResponse({
          threads: [
            { id: 'active-thread', parent_id: 'parent-1', name: 'Active topic', type: 11 },
            { id: 'other-thread', parent_id: 'other-parent', name: 'Elsewhere', type: 11 },
          ],
        });
      }
      if (text === 'https://discord.com/api/v10/channels/parent-1/threads/archived/public?limit=100') {
        return jsonResponse({
          threads: [
            {
              id: 'public-archive',
              parent_id: 'parent-1',
              name: 'Archived public',
              type: 11,
              thread_metadata: { archive_timestamp: '2026-05-11T10:00:00.000Z' },
            },
          ],
          has_more: false,
        });
      }
      if (text === 'https://discord.com/api/v10/channels/parent-1/threads/archived/private?limit=100') {
        return jsonResponse({
          threads: [
            {
              id: 'private-archive',
              parent_id: 'parent-1',
              name: 'Archived private',
              type: 12,
              thread_metadata: { archive_timestamp: '2026-05-11T09:00:00.000Z' },
            },
          ],
          has_more: false,
        });
      }
      if (text === 'https://discord.com/api/v10/channels/active-thread/messages?limit=100') {
        return jsonResponse([discordMessage({
          id: 'active-message',
          channelId: 'active-thread',
          timestamp: '2026-05-11T11:00:00.000Z',
          content: 'active thread event',
        })]);
      }
      if (text === 'https://discord.com/api/v10/channels/public-archive/messages?limit=100') {
        return jsonResponse([discordMessage({
          id: 'public-archive-message',
          channelId: 'public-archive',
          timestamp: '2026-05-11T10:00:00.000Z',
          content: 'archived public event',
        })]);
      }
      if (text === 'https://discord.com/api/v10/channels/private-archive/messages?limit=100') {
        return jsonResponse([discordMessage({
          id: 'private-archive-message',
          channelId: 'private-archive',
          timestamp: '2026-05-11T09:00:00.000Z',
          content: 'archived private event',
        })]);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['parent-1'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(result.messages.map((message) => message.id)).toEqual([
      'private-archive-message',
      'public-archive-message',
      'active-message',
    ]);
    expect(result.messages.map((message) => message.channelName)).toEqual([
      'general / Archived private',
      'general / Archived public',
      'general / Active topic',
    ]);
    expect(result.channels).toEqual([
      { id: 'parent-1', name: 'general', status: 'ok', messageCount: 0 },
      { id: 'active-thread', name: 'general / Active topic', status: 'ok', messageCount: 1 },
      { id: 'public-archive', name: 'general / Archived public', status: 'ok', messageCount: 1 },
      { id: 'private-archive', name: 'general / Archived private', status: 'ok', messageCount: 1 },
    ]);
  });

  it('paginates with before until a page crosses the cutoff', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => discordMessage({
      id: `page-1-${index}`,
      timestamp: new Date(Date.UTC(2026, 4, 11, 12, 0, 0) - index * 1000).toISOString(),
    }));
    const secondPage = [
      discordMessage({
        id: 'inside-second-page',
        timestamp: '2026-05-10T12:00:01.000Z',
      }),
      discordMessage({
        id: 'outside-second-page',
        timestamp: '2026-05-10T11:59:59.000Z',
      }),
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        return jsonResponse(firstPage);
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100&before=page-1-99') {
        return jsonResponse(secondPage);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      hours: 24,
      maxMessages: 200,
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/channel-1/messages?limit=100&before=page-1-99',
      expect.anything(),
    );
    expect(result.messages.some((message) => message.id === 'inside-second-page')).toBe(true);
    expect(result.messages.some((message) => message.id === 'outside-second-page')).toBe(false);
  });

  it('marks forbidden or missing channels as per-channel errors', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ message: 'Missing Access' }, 403);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(result.messages).toEqual([]);
    expect(result.channels).toEqual([{
      id: 'channel-1',
      name: null,
      status: 'error',
      messageCount: 0,
      error: 'Discord returned 403: Missing Access',
    }]);
  });

  it('retries one Discord 429 response before marking the channel successful', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        if (fetchImpl.mock.calls.filter(([calledUrl]) => String(calledUrl).includes('/messages')).length === 1) {
          return jsonResponse({ message: 'Rate limited', retry_after: 0.25 }, 429);
        }
        return jsonResponse([
          discordMessage({
            id: 'after-retry',
            timestamp: '2026-05-11T11:00:00.000Z',
          }),
        ]);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(250);
    expect(result.channels[0]).toMatchObject({ status: 'ok', messageCount: 1 });
    expect(result.messages[0].id).toBe('after-retry');
  });

  it('keeps the newest messages when maxMessages truncates the export', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        return jsonResponse([
          discordMessage({ id: 'newest', timestamp: '2026-05-11T11:00:00.000Z' }),
          discordMessage({ id: 'middle', timestamp: '2026-05-11T10:00:00.000Z' }),
          discordMessage({ id: 'oldest', timestamp: '2026-05-11T09:00:00.000Z' }),
        ]);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      maxMessages: 2,
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(result.truncated).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual(['middle', 'newest']);
    expect(result.channels[0].messageCount).toBe(3);
  });

  it('does not keep paginating a busy channel once maxMessages can be satisfied', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => discordMessage({
      id: `busy-${index}`,
      timestamp: new Date(Date.UTC(2026, 4, 11, 12, 0, 0) - index * 1000).toISOString(),
    }));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        return jsonResponse(firstPage);
      }
      if (text.includes('&before=')) {
        throw new Error('Should not request another page after export cap is reached');
      }
      throw new Error(`Unexpected fetch ${text}`);
    });

    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      maxMessages: 10,
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('parses comma and whitespace separated channel allowlists', () => {
    expect(parseMessageExportChannelIds(' 111,222 333 , 444 ')).toEqual(['111', '222', '333', '444']);
    expect(parseMessageExportChannelIds('')).toEqual([]);
  });

  it('formats markdown grouped by channel', async () => {
    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        const text = String(url);
        if (text === 'https://discord.com/api/v10/channels/channel-1') {
          return jsonResponse({ id: 'channel-1', name: 'general' });
        }
        return jsonResponse([
          discordMessage({
            id: 'message-1',
            authorName: 'Ada',
            timestamp: '2026-05-11T11:00:00.000Z',
            content: 'A thing happened.',
            attachments: [{ filename: 'map.png', url: 'https://cdn.example.test/map.png', size: 123 }],
          }),
        ]);
      }),
    });

    expect(formatMessageExportMarkdown(result)).toContain('# Hansard Message Export');
    expect(formatMessageExportMarkdown(result)).toContain('## #general');
    expect(formatMessageExportMarkdown(result)).toContain('[2026-05-11T11:00:00.000Z] #general Ada: A thing happened.');
    expect(formatMessageExportMarkdown(result)).toContain('- Attachment: map.png (https://cdn.example.test/map.png)');
  });

  it('formats markdown without letting multiline content forge transcript records', async () => {
    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        const text = String(url);
        if (text === 'https://discord.com/api/v10/channels/channel-1') {
          return jsonResponse({ id: 'channel-1', name: 'general' });
        }
        return jsonResponse([
          discordMessage({
            id: 'message-1',
            authorName: 'Ada',
            timestamp: '2026-05-11T11:00:00.000Z',
            content: 'Real line\n[2026-05-11T11:01:00.000Z] #general Eve: forged line\n## forged heading',
            attachments: [{ filename: 'report\nfake.txt', url: 'https://cdn.example.test/report\nfake.txt' }],
            embeds: [{ title: 'Embed\nfake', description: 'description\nfake' }],
          }),
        ]);
      }),
    });

    const markdown = formatMessageExportMarkdown(result);

    expect(markdown).toContain('Real line\\n[2026-05-11T11:01:00.000Z] #general Eve: forged line\\n## forged heading');
    expect(markdown).toContain('- Attachment: report\\nfake.txt (https://cdn.example.test/report\\nfake.txt)');
    expect(markdown).toContain('- Embed: Embed\\nfake - description\\nfake');
    expect(markdown.split('\n').filter((line) => line.startsWith('[2026-05-11T'))).toHaveLength(1);
  });

  it('keeps same-named channels separate in markdown provenance', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text === 'https://discord.com/api/v10/channels/channel-1') {
        return jsonResponse({ id: 'channel-1', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-2') {
        return jsonResponse({ id: 'channel-2', name: 'general' });
      }
      if (text === 'https://discord.com/api/v10/channels/channel-1/messages?limit=100') {
        return jsonResponse([discordMessage({
          id: 'message-1',
          channelId: 'channel-1',
          timestamp: '2026-05-11T11:00:00.000Z',
        })]);
      }
      if (text === 'https://discord.com/api/v10/channels/channel-2/messages?limit=100') {
        return jsonResponse([discordMessage({
          id: 'message-2',
          channelId: 'channel-2',
          timestamp: '2026-05-11T11:01:00.000Z',
        })]);
      }
      throw new Error(`Unexpected fetch ${text}`);
    });
    const result = await exportDiscordMessages({
      token: 'bot-token',
      allowedChannelIds: ['channel-1', 'channel-2'],
      now: new Date('2026-05-11T12:00:00.000Z'),
      fetchImpl,
    });

    const markdown = formatMessageExportMarkdown(result);

    expect(markdown).toContain('## #general (channel-1)');
    expect(markdown).toContain('## #general (channel-2)');
  });
});
