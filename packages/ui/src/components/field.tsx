import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

/** Label + control + hint + error, wired together for accessibility. */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs text-subtle-foreground">Optional</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="copy-13 text-red">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="copy-13 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
