import { useInfiniteQuery } from '@tanstack/react-query';
import { apiPage } from '@/lib/api';

/** A cursor-paginated admin list ("Load more"). `params` are part of the cache key. */
export function useCursorList<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
) {
  const q = useInfiniteQuery({
    queryKey: ['console', 'list', path, params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<T>(path, { query: { limit: 25, ...params, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return { ...q, rows: q.data?.pages.flatMap((p) => p.data) ?? [] };
}
