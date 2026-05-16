import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RouteGuard } from './RouteGuard';
import * as authHook from '../../api/hooks/useAuth';

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

function renderWithQc(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RouteGuard', () => {
  it('renders skeleton while loading', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null, isStaff: false, permissions: [], hasPermission: () => false,
      logout: vi.fn(), isLoading: true,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-guard-skeleton')).toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null, isStaff: false, permissions: [], hasPermission: () => false,
      logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.getByTestId('navigate')).toHaveTextContent('/login');
  });

  it('renders children when authenticated', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  it('renders Forbidden when requireStaff but user is not staff', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard requireStaff><div>staff-only</div></RouteGuard>);
    expect(screen.queryByText('staff-only')).not.toBeInTheDocument();
    expect(screen.getByText(/Out of bounds/)).toBeInTheDocument();
  });

  it('renders children when requireStaff and user IS staff', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: true } as any, isStaff: true, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard requireStaff><div>staff-only</div></RouteGuard>);
    expect(screen.getByText('staff-only')).toBeInTheDocument();
  });
});
