import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Hairline-only tables: no zebra stripes, a quiet header, rows highlight on hover. */
export const Table = ({ className, ...p }: ComponentProps<'table'>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full border-collapse text-left text-sm', className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: ComponentProps<'thead'>) => (
  <thead className={cn('bg-surface', className)} {...p} />
);
export const TBody = (p: ComponentProps<'tbody'>) => <tbody {...p} />;
export const TR = ({ className, ...p }: ComponentProps<'tr'>) => (
  <tr className={cn('border-b border-border last:border-0 hover:bg-hover/60', className)} {...p} />
);
export const TH = ({ className, ...p }: ComponentProps<'th'>) => (
  <th
    className={cn(
      'h-10 whitespace-nowrap px-4 text-left text-xs font-medium text-muted-foreground first:pl-5 last:pr-5',
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: ComponentProps<'td'>) => (
  <td className={cn('px-4 py-3 align-middle first:pl-5 last:pr-5', className)} {...p} />
);
