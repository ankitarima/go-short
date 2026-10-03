import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import type { Heading } from './lib/content';

/** "On this page": highlights the section currently in view. */
export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState<string>(headings[0]?.id ?? '');
  useEffect(() => {
    if (!headings.length || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="sticky top-24">
      <h2 className="label-12 mb-3 uppercase tracking-wider text-subtle-foreground">
        On this page
      </h2>
      <ul className="flex flex-col border-l border-border">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                '-ml-px block border-l py-1 text-[13px] leading-5 transition-colors',
                h.level === 3 ? 'pl-6' : 'pl-3',
                active === h.id
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
