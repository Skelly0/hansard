import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { UserMenu } from './UserMenu';
import { AUTH_QUERY_KEY, type SessionUser } from '../../api/hooks/useAuth';

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { api } from '../../api/client';

const cached: SessionUser = {
  id: 'p1',
  discordId: '123',
  username: 'alice',
  avatar: null,
  isStaff: false,
  staffRole: null,
  permissions: [],
};

function renderUserMenu() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(AUTH_QUERY_KEY, cached);
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <UserMenu collapsed={false} />
      </QueryClientProvider>,
    ),
  };
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to /login after a successful logout', async () => {
    (api.post as any).mockResolvedValueOnce({});
    const user = userEvent.setup();
    const { qc } = renderUserMenu();

    await user.click(screen.getByRole('button', { name: /user menu/i }));
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/login' }));
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
  });

  it('still navigates to /login when the logout request rejects', async () => {
    (api.post as any).mockRejectedValueOnce({ status: 500 });
    const user = userEvent.setup();
    const { qc } = renderUserMenu();

    await user.click(screen.getByRole('button', { name: /user menu/i }));
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Even though POST /auth/logout failed, the user must end up at /login
    // and their cached session must be cleared client-side.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/login' }));
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
  });
});
