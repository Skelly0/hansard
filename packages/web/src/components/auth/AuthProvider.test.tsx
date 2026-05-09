import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AuthProvider } from './AuthProvider';
import { RouteGuard } from './RouteGuard';
import { AUTH_QUERY_KEY, type SessionUser } from '../../api/hooks/useAuth';
import { usePlayers } from '../../api/hooks/usePlayers';
import { ApiError, api } from '../../api/client';

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

const cachedUser: SessionUser = {
  id: 'p1',
  discordId: '123',
  username: 'alice',
  avatar: null,
  isStaff: false,
  staffRole: null,
  permissions: [],
};

function PlayersProbe() {
  const { isError } = usePlayers({ limit: 1 });
  return isError ? <div data-testid="players-error">players failed</div> : <div>players loading</div>;
}

function renderWithAuthCache(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(AUTH_QUERY_KEY, cachedUser);

  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears stale auth when a protected query receives a 401', async () => {
    (api.get as any).mockImplementation((path: string) => {
      if (path.startsWith('/players')) {
        return Promise.reject(new ApiError(401, '{"error":"Authentication required"}'));
      }
      if (path === '/auth/me') return Promise.resolve(cachedUser);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    renderWithAuthCache(
      <RouteGuard>
        <PlayersProbe />
      </RouteGuard>,
    );

    await waitFor(() => expect(screen.getByTestId('navigate')).toHaveTextContent('/login'));
    expect(screen.queryByTestId('players-error')).not.toBeInTheDocument();
  });
});
