import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { AUTH_QUERY_KEY, useAuth } from '../../api/hooks/useAuth';

interface AuthProviderProps {
  children: React.ReactNode;
}

function isAuthQueryKey(queryKey: readonly unknown[]) {
  return queryKey.length === AUTH_QUERY_KEY.length
    && queryKey.every((part, index) => part === AUTH_QUERY_KEY[index]);
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
  const qc = useQueryClient();

  // Touch the query to ensure it's instantiated before children render.
  useAuth();

  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (isAuthQueryKey(event.query.queryKey)) return;

      const error = event.query.state.error;
      if (event.query.state.status === 'error' && error instanceof ApiError && error.status === 401) {
        qc.setQueryData(AUTH_QUERY_KEY, null);
      }
    });
  }, [qc]);

  return <>{children}</>;
}
