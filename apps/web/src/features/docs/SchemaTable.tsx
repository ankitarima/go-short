import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@go-short/ui/lib/cn';
import type { Row } from './lib/openapi';

function RowView({ row, depth }: { row: Row; depth: number }) {
  const [open, setOpen] = useState(false);
  const expandable = row.children.length > 0;
  return (
    <li className={cn('border-b border-border last:border-b-0', depth > 0 && 'bg-surface/50')}>
      <div className="flex gap-3 py-3 pr-4" style={{ paddingLeft: 16 + depth * 20 }}>
        <div className="w-4 shrink-0 pt-0.5">
          {expandable && (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} fields of ${row.name}`}
              className="text-subtle-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="font-mono text-[13px] font-semibold">{row.name}</code>
            <span className="font-mono text-[12px] text-muted-foreground">{row.type}</span>
            {row.required && (
              <span className="label-12 rounded bg-red-soft px-1.5 py-px text-red">required</span>
            )}
          </div>
          {row.description && (
            <p className="mt-1 text-[13.5px] leading-6 text-muted-foreground">{row.description}</p>
          )}
          {row.constraints.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {row.constraints.map((c) => (
                <span
                  key={c}
                  className="rounded border border-border px-1.5 py-px font-mono text-[11px] text-subtle-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {expandable && open && (
        <ul className="border-t border-border">
          {row.children.map((c) => (
            <RowView key={c.name} row={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SchemaTable({ rows, empty = 'No fields.' }: { rows: Row[]; empty?: string }) {
  if (!rows.length) return <p className="text-[13.5px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="overflow-hidden rounded-lg border border-border">
      {rows.map((r) => (
        <RowView key={r.name} row={r} depth={0} />
      ))}
    </ul>
  );
}
