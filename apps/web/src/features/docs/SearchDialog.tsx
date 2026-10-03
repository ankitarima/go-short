import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BookOpen, CornerDownLeft, Search, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { MethodBadge } from './MethodBadge';
import { buildIndex, search } from './lib/search';
import { PAGES } from './lib/content';
import { useSpec } from './useSpec';

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const spec = useSpec().data;
  const index = useMemo(() => buildIndex(PAGES, spec), [spec]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => search(index, q), [index, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  function go(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]!.path);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[var(--overlay)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-pop-in overflow-hidden rounded-xl border border-border bg-background shadow-menu"
        >
          <DialogPrimitive.Title className="sr-only">
            Search the documentation
          </DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 text-subtle-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search guides and API endpoints"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="docs-search-results"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-subtle-foreground">
              Esc
            </kbd>
          </div>
          <div id="docs-search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {!q.trim() && (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                Type to search, for example “webhook”, “slug” or “POST links”.
              </p>
            )}
            {q.trim() && results.length === 0 && (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                No results for “{q}”.
              </p>
            )}
            {results.map((r, i) => (
              <button
                key={r.path}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.path)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                  i === active ? 'bg-hover' : '',
                )}
              >
                {r.method ? (
                  <MethodBadge method={r.method} />
                ) : r.group === 'Guides' ? (
                  <BookOpen className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                ) : (
                  <Terminal className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{r.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {r.subtitle}
                  </span>
                </span>
                <span className="label-12 hidden text-subtle-foreground sm:block">{r.group}</span>
                {i === active && (
                  <CornerDownLeft className="size-3.5 text-subtle-foreground" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
