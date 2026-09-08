/**
 * Shared TanStack Query client.
 *
 * Before this, every view was an island: `useState` triads for data/loading/error,
 * a fetch-on-mount `useEffect`, and a full refetch after each mutation. Nothing
 * was cached or shared, so switching views re-fetched everything.
 *
 * Defaults are tuned for an admin panel over Supabase:
 *  - `staleTime` 30s so tabbing between views is instant but data stays fresh.
 *  - No retry on 4xx: with RLS in play, a 401/403 means "not allowed" or "session
 *    over", and retrying just delays the sign-out the session policy is about to do.
 */

import { QueryClient } from '@tanstack/react-query';

/** PostgREST/Supabase errors carry a `status`; anything 4xx is not worth retrying. */
const isClientError = (error: unknown): boolean => {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Query key factory. Centralised so an invalidation can never silently miss a
 * cache entry because two call sites spelled the key differently.
 */
export const queryKeys = {
  stockholders: {
    all: ['stockholders'] as const,
    paginated: (page: number, pageSize: number, search: string) =>
      ['stockholders', 'paginated', page, pageSize, search] as const,
    lookup: () => ['stockholders', 'lookup'] as const,
    detail: (id: string) => ['stockholders', 'detail', id] as const,
  },
  transactions: {
    all: ['transactions'] as const,
    paginated: (page: number, pageSize: number, search: string) =>
      ['transactions', 'paginated', page, pageSize, search] as const,
    byStockholder: (id: string) => ['transactions', 'stockholder', id] as const,
  },
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
  },
  dividends: {
    all: ['dividends'] as const,
  },
  tawani: {
    news: (period: string, limit: number) => ['tawani', 'news', period, limit] as const,
    health: ['tawani', 'health'] as const,
    reports: ['tawani', 'reports'] as const,
  },
} as const;
