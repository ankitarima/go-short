import { AlertCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Skeleton } from './skeleton';

/** Useful empty state: say what this is, why it is empty, and offer the next step. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="heading-16">{title}</h3>
        {description && <p className="copy-14 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong while loading this.';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-red/30 bg-red-soft px-6 py-10 text-center',
        className,
      )}
    >
      <AlertCircle className="size-6 text-red" />
      <div>
        <p className="label-14 text-red">{message}</p>
        {requestId && (
          <p className="mono-13 mt-1 text-xs text-muted-foreground">Request ID: {requestId}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-5 py-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-1/4' : 'w-1/6')} />
          ))}
        </div>
      ))}
    </div>
  );
}
