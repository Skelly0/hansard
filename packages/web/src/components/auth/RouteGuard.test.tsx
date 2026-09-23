import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RouteGuard, RETURN_TO_STORAGE_KEY, isSafeReturnPath } from './RouteGuard';
import * as authHook from '../../api/hooks/useAuth';

const router = vi.hoisted(() => ({ href: '/', navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => router.navigate,
  useRouterState: ({ select }: { select: (s: any) => unknown }) => select({ location: { href: router.href } }),
}));

function renderWithQc(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RouteGuard', () => {
  beforeEach(() => {
    router.href = '/';
    router.navigate.mockReset();
    sessionStorage.clear();
  });

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

  it('remembers the deep link when bouncing an anonymous visitor to /login', () => {
    router.href = '/bills/free-ports-act';
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: null, isStaff: false, permissions: [], hasPermission: () => false,
      logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBe('/bills/free-ports-act');
  });

  it('returns a freshly signed-in user from / to the remembered deep link once', () => {
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/voting/abc');
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/voting/abc', replace: true });
    expect(sessionStorage.getItem(RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('ignores unsafe stored return paths', () => {
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '//evil.example/phish');
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: { id: 'p1', isStaff: false } as any, isStaff: false, permissions: [],
      hasPermission: () => false, logout: vi.fn(), isLoading: false,
    } as any);
    renderWithQc(<RouteGuard><div>protected</div></RouteGuard>);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('isSafeReturnPath', () => {
  it('accepts same-origin paths only', () => {
    expect(isSafeReturnPath('/bills/x?tab=1')).toBe(true);
    expect(isSafeReturnPath('//evil.example')).toBe(false);
    expect(isSafeReturnPath('https://evil.example')).toBe(false);
    expect(isSafeReturnPath('/login?error=denied')).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
  });
});
