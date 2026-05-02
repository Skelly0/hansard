import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuth } from './useAuth';

// Mock the api client
vi.mock('../client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: 1 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user and isStaff when authed', async () => {
    (api.get as any).mockResolvedValueOnce({
      id: 'p1', discordId: '123', username: 'alice',
      avatar: null, isStaff: true, staffRole: 'admin', permissions: ['call_elections'],
    });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user?.username).toBe('alice');
    expect(result.current.isStaff).toBe(true);
    expect(result.current.permissions).toEqual(['call_elections']);
    expect(result.current.hasPermission('call_elections')).toBe(true);
    expect(result.current.hasPermission('appoint_ministers')).toBe(false);
  });

  it('returns null user and false isStaff when 401', async () => {
    (api.get as any).mockRejectedValueOnce({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.isStaff).toBe(false);
    expect(result.current.permissions).toEqual([]);
  });

  it('does not retry on 401', async () => {
    (api.get as any).mockRejectedValue({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Despite global retry: 1, useAuth must opt out
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
