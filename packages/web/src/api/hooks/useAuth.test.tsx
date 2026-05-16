import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuth, AUTH_QUERY_KEY, type SessionUser } from './useAuth';

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

function wrapWithClient(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
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

  it('clears the cached auth session even when logout request rejects', async () => {
    const cached: SessionUser = {
      id: 'p1',
      discordId: '123',
      username: 'alice',
      avatar: null,
      isStaff: false,
      staffRole: null,
      permissions: [],
    };
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(AUTH_QUERY_KEY, cached);
    qc.setQueryData(['some', 'other', 'cached'], { stuff: 'value' });

    // Logout endpoint fails (network blip / 5xx / dead-session 401)
    (api.post as any).mockRejectedValueOnce({ status: 500 });
    // /auth/me should not be called again before we call logout, but if it is,
    // surface it as a 401 so we don't accidentally re-populate the cache.
    (api.get as any).mockRejectedValue({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: wrapWithClient(qc) });

    await act(async () => {
      // The hook surfaces logout via mutateAsync; the failure should not throw
      // the cache-clear away. We swallow the rejection in this test since we
      // only care about cache state afterwards.
      await result.current.logout().catch(() => {});
    });

    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
    // Full cache clear: unrelated keys also evicted so a stale user can't see
    // someone else's cached pages.
    expect(qc.getQueryData(['some', 'other', 'cached'])).toBeUndefined();
  });

  it('clears the cached auth session when logout succeeds', async () => {
    const cached: SessionUser = {
      id: 'p1',
      discordId: '123',
      username: 'alice',
      avatar: null,
      isStaff: false,
      staffRole: null,
      permissions: [],
    };
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(AUTH_QUERY_KEY, cached);
    (api.post as any).mockResolvedValueOnce({});
    (api.get as any).mockRejectedValue({ status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper: wrapWithClient(qc) });

    await act(async () => {
      await result.current.logout();
    });

    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
  });
});
