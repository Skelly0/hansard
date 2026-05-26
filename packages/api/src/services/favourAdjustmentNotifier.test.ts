import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavourTransactionType } from '@hansard/shared';
import { notifyFavourAdjustment } from './favourAdjustmentNotifier.js';

const originalFetch = globalThis.fetch;

function makeDb(rows: unknown[][]) {
  const queue = [...rows];
  const limit = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

describe('notifyFavourAdjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    delete process.env.FAVOUR_DM_BOT_TOKEN;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/users/@me/channels')) {
        return new Response(JSON.stringify({ id: 'dm-channel-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'sent-message-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.FAVOUR_DM_BOT_TOKEN;
  });

  it('opens a DM and sends a favour adjustment embed to the player', async () => {
    const db = makeDb([
      [{
        discordId: 'target-discord-id',
        discordUsername: 'mira',
        characterName: 'Mira Sol',
      }],
      [{
        name: 'Crown',
        emoji: 'C',
      }],
    ]);

    await expect(notifyFavourAdjustment({
      db: db as any,
      transaction: {
        id: 'tx-1',
        playerId: 'target-player',
        categoryId: 'category-1',
        amount: 5,
        balanceAfter: 12,
        type: FavourTransactionType.GRANT,
        reason: 'web reward',
        grantedById: 'staff-player',
        simTick: null,
        simDate: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })).resolves.toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/users/@me/channels',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bot bot-token' }),
        body: JSON.stringify({ recipient_id: 'target-discord-id' }),
      }),
    );

    const messageCall = vi.mocked(globalThis.fetch).mock.calls.find(([url]) =>
      String(url).endsWith('/channels/dm-channel-1/messages'),
    );
    expect(messageCall).toBeDefined();
    const body = JSON.parse((messageCall?.[1] as RequestInit).body as string);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].title).toBe('Favours Granted');
    expect(body.embeds[0].description).toContain('+5');
    expect(body.embeds[0].description).toContain('Crown');
    expect(body.embeds[0].description).toContain('New balance: `12`');
    expect(body.embeds[0].description).toContain('web reward');
  });

  it('does not throw when Discord rejects the DM send', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/users/@me/channels')) {
        return new Response(JSON.stringify({ id: 'dm-channel-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('DMs closed', { status: 403 });
    }) as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb([
      [{ discordId: 'target-discord-id', discordUsername: 'mira', characterName: null }],
      [{ name: 'Crown', emoji: null }],
    ]);

    try {
      await expect(notifyFavourAdjustment({
        db: db as any,
        transaction: {
          id: 'tx-1',
          playerId: 'target-player',
          categoryId: 'category-1',
          amount: -2,
          balanceAfter: 3,
          type: FavourTransactionType.REMOVE,
          reason: null,
          grantedById: 'staff-player',
          simTick: null,
          simDate: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })).resolves.toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
