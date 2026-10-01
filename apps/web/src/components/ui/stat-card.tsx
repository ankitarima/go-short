import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from './skeleton';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="label-14">{label}</span>
        {Icon && <Icon className="size-4" />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div className="mt-2 text-[28px] font-semibold leading-9 tracking-[-0.04em] tabular-nums">
          {value}
        </div>
      )}
      {hint && <div className="copy-13 mt-1 text-muted-foreground">{hint}</div>}
    </div>
  );
}
