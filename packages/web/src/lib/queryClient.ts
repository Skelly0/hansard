import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { toast } from './toast';

/** Retry transient failures once, but never 4xx (a 404/403 won't change on retry). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // Mutations opt into feedback through `meta` (see lib/toast.ts), so hooks
    // declare their messages once and every caller gets consistent toasts.
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _ctx, mutation) => {
        const message = mutation.meta?.successMessage;
        const text = typeof message === 'function' ? message(data, variables) : message;
        if (text) toast.success(text);
      },
      onError: (error, _variables, _ctx, mutation) => {
        const title = mutation.meta?.errorMessage;
        if (title) toast.error(title, error instanceof Error ? error.message : undefined);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
      },
    },
  });
}
