import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from './Markdown';
import { Toc } from './Toc';
import { findPage, pagesOf, type Area, type DocPage } from './lib/content';
import { DocsNotFound } from './DocsNotFound';

/** One Markdown page with its table of contents and previous/next links. */
export function DocView({ page, after }: { page: DocPage; after?: ReactNode }) {
  const siblings = pagesOf(page.area);
  const i = siblings.findIndex((p) => p.path === page.path);
  const prev = siblings[i - 1];
  const next = siblings[i + 1];
  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_200px]">
      <article className="min-w-0 max-w-[760px]">
        <p className="label-12 mb-3 uppercase tracking-wider text-blue">{page.section}</p>
        <h1 className="heading-32 text-balance">{page.title}</h1>
        {page.description && (
          <p className="mt-3 text-[17px] leading-7 text-muted-foreground">{page.description}</p>
        )}
        <div className="mt-8">
          <Markdown source={page.body} />
        </div>
        {after}
        <nav
          aria-label="Previous and next page"
          className="mt-16 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
        >
          {prev ? (
            <Link
              to={prev.path}
              className="group rounded-lg border border-border p-4 hover:border-border-strong"
            >
              <span className="label-12 flex items-center gap-1 text-subtle-foreground">
                <ArrowLeft className="size-3.5" aria-hidden /> Previous
              </span>
              <span className="mt-1 block text-[15px] font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to={next.path}
              className="group rounded-lg border border-border p-4 text-right hover:border-border-strong sm:col-start-2"
            >
              <span className="label-12 flex items-center justify-end gap-1 text-subtle-foreground">
                Next <ArrowRight className="size-3.5" aria-hidden />
              </span>
              <span className="mt-1 block text-[15px] font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      <aside className="hidden xl:block">
        <Toc headings={page.headings} />
      </aside>
    </div>
  );
}

export function GuidePage() {
  const { slug = '' } = useParams();
  const page = findPage('guides' as Area, slug);
  return page ? <DocView page={page} /> : <DocsNotFound />;
}
