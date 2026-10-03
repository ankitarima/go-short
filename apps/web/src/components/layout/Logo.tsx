import { cn } from '@go-short/ui/lib/cn';

/** goShort mark: two forward chevrons ("go") in a rounded square, with the wordmark. */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path
        d="M9 10l6 6-6 6M16 10l6 6-6 6"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-background"
      />
    </svg>
  );
}

export function Logo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {withName && <span className="text-[15px] font-semibold tracking-[-0.02em]">goShort</span>}
    </span>
  );
}
