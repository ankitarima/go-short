import { cn } from '@/lib/cn';

/** A plain triangle mark in the Vercel manner, with the product name. */
export function Logo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden className="text-foreground">
        <path d="M12 3l10 18H2z" fill="currentColor" />
      </svg>
      {withName && <span className="text-[15px] font-semibold tracking-[-0.02em]">Go-Short</span>}
    </span>
  );
}
