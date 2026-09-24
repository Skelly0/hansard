import { useEffect } from 'react';
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { PageSkeleton } from '../shared/SkeletonLoader';
import { Forbidden } from './Forbidden';

interface RouteGuardProps {
  requireStaff?: boolean;
  requirePermission?: string;
  children: React.ReactNode;
}

export const RETURN_TO_STORAGE_KEY = 'hansard-return-to';

/** Only same-origin absolute paths — never `//host` or a full URL. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login');
}

function rememberReturnPath(path: string) {
  if (!isSafeReturnPath(path) || path === '/') return;
  try {
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, path);
  } catch {
    // Storage unavailable — the user just lands on the dashboard.
  }
}

function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    return isSafeReturnPath(path) ? path : null;
  } catch {
    return null;
  }
}

export function RouteGuard({ requireStaff, requirePermission, children }: RouteGuardProps) {
  const { user, isStaff, hasPermission, isLoading } = useAuth();
  const href = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();

  // The Discord OAuth callback always lands on "/". If the user was bounced
  // to /login from a deep link (e.g. a bill URL pasted in Discord), send them
  // back there once they are signed in.
  useEffect(() => {
    if (!user || href !== '/') return;
    const returnTo = takeReturnPath();
    if (returnTo && returnTo !== '/') navigate({ to: returnTo, replace: true });
  }, [user, href, navigate]);

  if (isLoading) {
    return <div data-testid="route-guard-skeleton"><PageSkeleton /></div>;
  }

  if (!user) {
    rememberReturnPath(href);
    return <Navigate to="/login" />;
  }

  if (requireStaff && !isStaff) {
    return <Forbidden />;
  }

  if (requirePermission && !hasPermission(requirePermission)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
