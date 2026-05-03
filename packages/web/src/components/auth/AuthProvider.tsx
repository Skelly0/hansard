import React from 'react';
import { useAuth } from '../../api/hooks/useAuth';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Lightweight provider — its main job is to instantiate the useAuth query
 * once at the root so all consumers share its cache. The actual auth state
 * lives in TanStack Query, not React Context.
 *
 * (We don't use React Context here because TanStack Query already provides
 * the cross-component state via the QueryClient.)
 */
export function AuthProvider({ children }: AuthProviderProps) {
  // Touch the query to ensure it's instantiated before children render.
  useAuth();
  return <>{children}</>;
}
