import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export interface SessionUser {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth() {
  const qc = useQueryClient();

  const query = useQuery<SessionUser | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch (err: any) {
        if (err?.status === 401) return null;
        throw err;
      }
    },
    retry: false,            // 401 is normal state, not error
    throwOnError: false,
    staleTime: Infinity,     // re-fetched only via invalidation after login/logout
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout', {}),
    // onSettled (not onSuccess) so a failing logout request — network blip,
    // 5xx, or a 401 from an already-dead session — still tears down the
    // client-side cache. The server endpoint is best-effort cookie cleanup;
    // if it fails the user must still be treated as signed-out locally.
    onSettled: () => {
      qc.clear();
      qc.setQueryData(AUTH_QUERY_KEY, null);
    },
  });

  const user = query.data ?? null;

  return {
    user,
    isStaff: user?.isStaff ?? false,
    permissions: user?.permissions ?? [],
    hasPermission: (name: string) => user?.permissions.includes(name) ?? false,
    logout: logoutMutation.mutateAsync,
    isLoading: query.isLoading,
  };
}
