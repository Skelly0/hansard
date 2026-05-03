import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { PageSkeleton } from '../shared/SkeletonLoader';
import { Forbidden } from './Forbidden';

interface RouteGuardProps {
  requireStaff?: boolean;
  requirePermission?: string;
  children: React.ReactNode;
}

export function RouteGuard({ requireStaff, requirePermission, children }: RouteGuardProps) {
  const { user, isStaff, hasPermission, isLoading } = useAuth();

  if (isLoading) {
    return <div data-testid="route-guard-skeleton"><PageSkeleton /></div>;
  }

  if (!user) {
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
