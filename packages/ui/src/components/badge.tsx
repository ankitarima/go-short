import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const badge = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        gray: 'bg-hover text-muted-foreground',
        outline: 'border border-border-strong text-muted-foreground',
        blue: 'bg-blue-soft text-blue',
        green: 'bg-green-soft text-green',
        amber: 'bg-amber-soft text-amber',
        red: 'bg-red-soft text-red',
        inverted: 'bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { tone: 'gray' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badge> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
