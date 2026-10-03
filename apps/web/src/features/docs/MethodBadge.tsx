import { cn } from '@go-short/ui/lib/cn';

const STYLE: Record<string, string> = {
  get: 'bg-blue-soft text-blue',
  post: 'bg-green-soft text-green',
  put: 'bg-amber-soft text-amber',
  patch: 'bg-amber-soft text-amber',
  delete: 'bg-red-soft text-red',
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-[2.75rem] items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        STYLE[method] ?? 'bg-hover text-muted-foreground',
        className,
      )}
    >
      {method === 'delete' ? 'del' : method}
    </span>
  );
}
