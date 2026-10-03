import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { NativeSelect } from './input';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Table footer: rows range, optional total, page size and previous/next. Works for cursor APIs (which
 * cannot jump to an arbitrary page) as well as in-memory lists.
 */
export function Pagination({
  from,
  to,
  total,
  page,
  pageSize,
  onPageSize,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  loading,
  sizes = PAGE_SIZES,
}: {
  /** 1-based index of the first and last row on this page (0/0 when empty). */
  from: number;
  to: number;
  total?: number | undefined;
  /** 0-based page index. */
  page: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  loading?: boolean;
  sizes?: readonly number[];
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground sm:flex-row"
    >
      <p aria-live="polite">
        {to === 0 ? (
          'No rows'
        ) : (
          <>
            Showing{' '}
            <span className="font-medium text-foreground">
              {from}–{to}
            </span>
            {total !== undefined && (
              <>
                {' '}
                of{' '}
                <span className="font-medium text-foreground">{total.toLocaleString('en-US')}</span>
              </>
            )}
          </>
        )}
      </p>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          Rows per page
          <NativeSelect
            aria-label="Rows per page"
            className="h-8 w-[72px] text-[13px]"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="tabular-nums">Page {page + 1}</span>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasPrev || loading}
            onClick={onPrev}
            aria-label="Previous page"
          >
            <ChevronLeft /> Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasNext || loading}
            onClick={onNext}
            aria-label="Next page"
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </nav>
  );
}
