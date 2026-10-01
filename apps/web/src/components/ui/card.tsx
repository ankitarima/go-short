import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Card = ({ className, ...p }: ComponentProps<'div'>) => (
  <div className={cn('rounded-xl border border-border bg-background', className)} {...p} />
);
export const CardHeader = ({ className, ...p }: ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...p} />
);
export const CardTitle = ({ className, ...p }: ComponentProps<'h3'>) => (
  <h3 className={cn('heading-16', className)} {...p} />
);
export const CardDescription = ({ className, ...p }: ComponentProps<'p'>) => (
  <p className={cn('copy-14 text-muted-foreground', className)} {...p} />
);
export const CardContent = ({ className, ...p }: ComponentProps<'div'>) => (
  <div className={cn('p-5', className)} {...p} />
);
/** Geist-style footer strip: a tinted band separated by a hairline. */
export const CardFooter = ({ className, ...p }: ComponentProps<'div'>) => (
  <div
    className={cn(
      'flex items-center justify-between gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3',
      className,
    )}
    {...p}
  />
);
