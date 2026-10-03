import type { ReactNode } from 'react';
import { formatNumber } from '@go-short/ui/lib/format';

export interface BreakdownItem {
  key: string;
  label: ReactNode;
  clicks: number;
}

/** A ranked list with a quiet proportional bar behind each row (Vercel Analytics style). */
export function BreakdownList({
  items,
  empty = 'No data yet',
}: {
  items: BreakdownItem[];
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  if (items.length === 0)
    return <p className="copy-14 py-6 text-center text-subtle-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => (
        <li
          key={i.key}
          className="relative flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-md bg-blue/10"
            style={{ width: `${Math.max(2, (i.clicks / max) * 100)}%` }}
          />
          <span className="relative min-w-0 truncate">{i.label}</span>
          <span className="relative shrink-0 tabular-nums text-muted-foreground">
            {formatNumber(i.clicks)}
          </span>
        </li>
      ))}
    </ul>
  );
}
