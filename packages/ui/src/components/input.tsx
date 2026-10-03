import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const field =
  'w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground placeholder:text-subtle-foreground transition-colors hover:border-subtle-foreground focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue/15 disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60 aria-[invalid=true]:border-red aria-[invalid=true]:focus-visible:ring-red/15';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-20 py-2', className)} {...props} />;
}

/** Native <select> styled like the other fields; used where the option list is long (timezones). */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        field,
        'h-10 appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238f8f8f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}
