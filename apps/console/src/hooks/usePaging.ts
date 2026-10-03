import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiPage } from '@/lib/api';

export interface PagerState {
  from: number;
  to: number;
  total?: number | undefined;
  page: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
}

/**
 * Previous/next paging over a cursor API. The cursor of every visited page is remembered, so "Previous"
 * is exact and cheap; changing the search, filters or page size starts again at page 1.
 */
export function usePagedList<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  initialSize = 25,
) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const key = JSON.stringify(params);
  useEffect(() => setCursors([undefined]), [key, pageSize]);
  const page = cursors.length - 1;
  const cursor = cursors[page];

  const q = useQuery({
    queryKey: ['console', 'list', path, params, pageSize, cursor ?? null],
    queryFn: () =>
      apiPage<T & { id?: string }>(path, { query: { ...params, limit: pageSize, cursor } }),
    placeholderData: keepPreviousData,
  });
  const rows = (q.data?.data ?? []) as T[];
  const total = q.data?.total;
  const from = rows.length ? page * pageSize + 1 : 0;
  const pager: PagerState = {
    from,
    to: rows.length ? from + rows.length - 1 : 0,
    total,
    page,
    pageSize,
    onPageSize: setPageSize,
    hasPrev: page > 0,
    hasNext: Boolean(q.data?.nextCursor),
    onPrev: () => setCursors((c) => c.slice(0, -1)),
    onNext: () => q.data?.nextCursor && setCursors((c) => [...c, q.data!.nextCursor!]),
    loading: q.isFetching,
  };
  return { rows, pager, query: q };
}

/** The same pager over a list that is already in memory (staff, failed jobs). */
export function useClientPaging<T>(items: T[], initialSize = 10) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const current = Math.min(page, lastPage);
  useEffect(() => setPage((p) => Math.min(p, lastPage)), [lastPage]);
  const rows = useMemo(
    () => items.slice(current * pageSize, current * pageSize + pageSize),
    [items, current, pageSize],
  );
  const from = rows.length ? current * pageSize + 1 : 0;
  const pager: PagerState = {
    from,
    to: rows.length ? from + rows.length - 1 : 0,
    total: items.length,
    page: current,
    pageSize,
    onPageSize: (n) => {
      setPageSize(n);
      setPage(0);
    },
    hasPrev: current > 0,
    hasNext: current < lastPage,
    onPrev: () => setPage(current - 1),
    onNext: () => setPage(current + 1),
    loading: false,
  };
  return { rows, pager };
}
