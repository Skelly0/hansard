import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from '@tanstack/react-router';
import React from 'react';

// Stub the API client so Login renders without network calls.
vi.mock('./api/client', () => ({
  API_BASE: 'http://test.invalid/api',
  api: {
    get: vi.fn().mockResolvedValue(null),
    post: vi.fn().mockResolvedValue(null),
  },
}));

// Stub useAuth so AuthProvider/RouteGuard don't need a real server.
vi.mock('./api/hooks/useAuth', () => {
  return {
    AUTH_QUERY_KEY: ['auth', 'me'],
    useAuth: () => ({
      user: null,
      isStaff: false,
      permissions: [],
      hasPermission: () => false,
      logout: vi.fn(),
      isLoading: false,
    }),
  };
});

// AuthProvider depends on listeners we don't need under test; render passthrough.
vi.mock('./components/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ThemeProvider similarly — skip the side-effects.
vi.mock('./components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

async function renderRouterAt(path: string) {
  // Reuse the production routeTree but with an isolated memory history so
  // each test can mount a specific URL without touching window.location.
  const { router: realRouter } = await import('./router');
  const router = createRouter({
    routeTree: realRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

describe('router shell layout', () => {
  it('does not render the app sidebar on the /login route', async () => {
    await renderRouterAt('/login');

    // The Login card should appear.
    await waitFor(() => {
      expect(screen.getByText(/Per Order of the Chamber/i)).toBeInTheDocument();
    });

    // The Sidebar must NOT leak into the unauthenticated layout.
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });
});
