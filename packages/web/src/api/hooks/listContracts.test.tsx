import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBillVoters, useBills } from './useBills';
import { useDocuments } from './useDocuments';
import { useFavourHistory } from './useFavours';
import { useModActions } from './useModeration';
import { usePlayers, useSearchPlayers } from './usePlayers';
import { useTickets } from './useTickets';
import { useElections } from './useVoting';

vi.mock('../client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../client';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function waitForGet() {
  await waitFor(() => expect(api.get).toHaveBeenCalled());
}

describe('list hook API contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: [], total: 0 });
  });

  it('serializes player filters with backend names and offset pagination', async () => {
    renderHook(
      () => usePlayers({
        faction: 'faction-1',
        party: 'party-1',
        alive: false,
        staff: true,
        page: 2,
        limit: 24,
      }),
      { wrapper },
    );

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith(
      '/players?factionId=faction-1&partyId=party-1&isStaff=true&isAlive=false&limit=24&offset=24',
    );
  });

  it('does not fetch all players for short typeahead searches', async () => {
    renderHook(() => useSearchPlayers('a'), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.get).not.toHaveBeenCalled();
  });

  it('serializes ticket filters with backend names and offset pagination', async () => {
    renderHook(
      () => useTickets({
        category: 'cat-1',
        assignee: 'user-1',
        page: 3,
        limit: 20,
      }),
      { wrapper },
    );

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith(
      '/tickets?categoryId=cat-1&assignedToId=user-1&limit=20&offset=40',
    );
  });

  it('serializes bill filters with backend names and offset pagination', async () => {
    renderHook(
      () => useBills({
        author: 'author-1',
        search: 'tax',
        sort: 'title',
        page: 2,
        limit: 20,
      }),
      { wrapper },
    );

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith(
      '/bills?authorId=author-1&search=tax&sort=title&limit=20&offset=20',
    );
  });

  it('serializes document filters with backend names and offset pagination', async () => {
    renderHook(
      () => useDocuments({
        collection: 'collection-1',
        author: 'author-1',
        search: 'charter',
        page: 4,
        limit: 10,
      }),
      { wrapper },
    );

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith(
      '/documents?collectionId=collection-1&authorId=author-1&search=charter&limit=10&offset=30',
    );
  });

  it('serializes election office filters with backend names', async () => {
    renderHook(() => useElections({ forOffice: 'office-1', page: 2, limit: 50 }), { wrapper });

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith('/elections?forOfficeId=office-1&page=2&limit=50');
  });

  it('serializes favour history category filters with backend names', async () => {
    renderHook(() => useFavourHistory('player-1', 'category-1'), { wrapper });

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith('/favours/history/player-1?categoryId=category-1');
  });

  it('serializes moderation pagination as an offset', async () => {
    renderHook(() => useModActions({ targetPlayerId: 'player-1', page: 3, limit: 20 }), { wrapper });

    await waitForGet();

    expect(api.get).toHaveBeenCalledWith('/moderation/actions?targetPlayerId=player-1&limit=20&offset=40');
  });

  it('normalizes bill voters returned by the API into the array shape consumed by BillDetail', async () => {
    (api.get as any).mockResolvedValueOnce({
      playerVotes: [
        { playerId: 'p1', characterName: 'Ada', choice: 'yea', castAt: '2026-01-01T00:00:00.000Z' },
      ],
      npcVote: null,
    });

    const { result } = renderHook(() => useBillVoters('bill-slug'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([
      { playerId: 'p1', characterName: 'Ada', choice: 'yea', castAt: '2026-01-01T00:00:00.000Z' },
    ]));
  });

  it('normalizes legacy bill voter ids so BillDetail links do not go undefined', async () => {
    (api.get as any).mockResolvedValueOnce({
      playerVotes: [
        { voterId: 'p1', discordUsername: 'ada', choice: 'nay', castAt: '2026-01-01T00:00:00.000Z' },
      ],
      npcVote: null,
    });

    const { result } = renderHook(() => useBillVoters('bill-slug'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([
      { playerId: 'p1', characterName: 'ada', choice: 'nay', castAt: '2026-01-01T00:00:00.000Z' },
    ]));
  });
});
