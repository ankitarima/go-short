import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Callout } from '@go-short/ui/components/callout';
import { CopyButton } from '@go-short/ui/components/copy-button';
import { Button } from '@go-short/ui/components/button';
import { cn } from '@go-short/ui/lib/cn';
import { CodeBlock } from './CodeBlock';
import { DocsNotFound } from './DocsNotFound';
import { DocView } from './GuidePage';
import { Markdown } from './Markdown';
import { MethodBadge } from './MethodBadge';
import { SchemaTable } from './SchemaTable';
import { findPage } from './lib/content';
import {
  LANGS,
  exampleOf,
  findOperation,
  operationPath,
  rowsOf,
  sampleFor,
  snippet,
  type Lang,
  type Operation,
  type Spec,
} from './lib/openapi';
import { useSpec } from './useSpec';

function SpecGate({ children }: { children: (spec: Spec) => React.ReactNode }) {
  const q = useSpec();
  if (q.isPending)
    return (
      <div className="max-w-[760px]" aria-busy aria-label="Loading">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton mt-4 h-9 w-2/3 rounded" />
        <div className="skeleton mt-6 h-11 w-full rounded-lg" />
        <div className="skeleton mt-8 h-40 w-full rounded-lg" />
      </div>
    );
  if (q.isError)
    return (
      <div
        role="alert"
        className="max-w-[760px] rounded-xl border border-red/30 bg-red-soft px-6 py-8"
      >
        <p className="label-14 text-red">The API description could not be loaded.</p>
        <p className="copy-14 mt-1 text-muted-foreground">
          The guides still work. Check your connection and try again.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  return <>{children(q.data)}</>;
}

/** /docs/api: the introduction, plus a card per resource. */
export function ApiIntroPage() {
  const page = findPage('api', 'introduction');
  if (!page) return <DocsNotFound />;
  return (
    <DocView
      page={page}
      after={
        <SpecGate>
          {(spec) => (
            <section className="mt-12" aria-label="Resources">
              <h2 className="mb-4 text-[22px] font-semibold tracking-[-0.02em]">Resources</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {spec.tags.map((t) => (
                  <Link
                    key={t.slug}
                    to={`/docs/api/${t.slug}`}
                    className="group rounded-lg border border-border p-4 transition-colors hover:border-border-strong hover:bg-surface"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold">{t.name}</span>
                      <ArrowRight
                        className="size-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13.5px] leading-5 text-muted-foreground">
                      {t.description}
                    </p>
                    <p className="label-12 mt-3 text-subtle-foreground">
                      {t.operations.length} endpoints
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </SpecGate>
      }
    />
  );
}

/** /docs/api/<segment>: an overview Markdown page, or the landing page of a resource. */
export function ApiSegmentPage() {
  const { segment = '' } = useParams();
  const page = findPage('api', segment);
  if (page) return <DocView page={page} />;
  return <SpecGate>{(spec) => <TagPage spec={spec} slug={segment} />}</SpecGate>;
}

function TagPage({ spec, slug }: { spec: Spec; slug: string }) {
  const tag = spec.tags.find((t) => t.slug === slug);
  if (!tag) return <DocsNotFound />;
  return (
    <div className="max-w-[760px]">
      <p className="label-12 mb-3 uppercase tracking-wider text-blue">API reference</p>
      <h1 className="heading-32">{tag.name}</h1>
      <p className="mt-3 text-[17px] leading-7 text-muted-foreground">{tag.description}</p>
      <ul className="mt-8 overflow-hidden rounded-lg border border-border">
        {tag.operations.map((o) => (
          <li key={o.id} className="border-b border-border last:border-b-0">
            <Link
              to={operationPath(o)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface"
            >
              <MethodBadge method={o.method} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{o.summary}</span>
                <code className="block truncate font-mono text-[12px] text-muted-foreground">
                  {o.path}
                </code>
              </span>
              <ArrowRight className="size-4 text-subtle-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /docs/api/<resource>/<operation> */
export function ApiOperationPage() {
  const { tag = '', op = '' } = useParams();
  return (
    <SpecGate>
      {(spec) => {
        const operation = findOperation(spec, tag, op);
        return operation ? <OperationView spec={spec} op={operation} /> : <DocsNotFound />;
      }}
    </SpecGate>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="mb-3 text-[19px] font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

const STATUS_TEXT: Record<string, string> = { '200': 'OK', '201': 'Created', '204': 'No content' };
const statusTone = (s: string) =>
  s.startsWith('2') ? 'text-green' : s.startsWith('4') ? 'text-amber' : 'text-red';

function OperationView({ spec, op }: { spec: Spec; op: Operation }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('gs.docs.lang');
      return LANGS.some((l) => l.id === saved) ? (saved as Lang) : 'curl';
    } catch {
      return 'curl';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('gs.docs.lang', lang);
    } catch {
      /* private mode: the choice just is not remembered */
    }
  }, [lang]);

  const sample = useMemo(() => sampleFor(spec, op), [spec, op]);
  const code = snippet(lang, sample);
  const hl = LANGS.find((l) => l.id === lang)!.hl;
  const success = op.responses.find((r) => r.status.startsWith('2'));
  const successExample = success?.schema
    ? JSON.stringify(exampleOf(spec.raw, success.schema), null, 2)
    : null;
  const pathParams = op.params.filter((p) => p.in === 'path');
  const queryParams = op.params.filter((p) => p.in === 'query');
  const headerParams = op.params.filter((p) => p.in === 'header');
  const fullUrl = `${spec.baseUrl}${op.path}`;

  const paramRows = (list: typeof op.params) =>
    list.map((p) => ({
      name: p.name,
      type: rowsOf(spec.raw, { type: 'object', properties: { x: p.schema } })[0]?.type ?? 'string',
      required: p.required,
      description: p.description ?? '',
      constraints:
        rowsOf(spec.raw, { type: 'object', properties: { x: p.schema } })[0]?.constraints ?? [],
      children: [],
    }));

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_420px]">
      <article className="min-w-0 max-w-[760px]">
        <nav
          aria-label="Breadcrumb"
          className="label-12 mb-3 flex items-center gap-1.5 text-subtle-foreground"
        >
          <Link to="/docs/api" className="hover:text-foreground">
            API reference
          </Link>
          <span aria-hidden>/</span>
          <Link to={`/docs/api/${op.tagSlug}`} className="hover:text-foreground">
            {op.tag}
          </Link>
        </nav>
        <h1 className="heading-32 text-balance">{op.summary}</h1>

        <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-surface py-1.5 pl-3 pr-1.5">
          <MethodBadge method={op.method} />
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]" title={fullUrl}>
            {op.path}
          </code>
          <CopyButton value={fullUrl} label="Copy URL" size="icon" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="rounded-full border border-border px-2.5 py-0.5">
            Authorization: API key
          </span>
          {op.permission && (
            <span className="rounded-full border border-border px-2.5 py-0.5">
              Needs <code className="font-mono">{op.permission}</code>
            </span>
          )}
        </div>

        {op.description && (
          <div className="mt-6">
            <Markdown source={op.description} />
          </div>
        )}

        {pathParams.length > 0 && (
          <Section title="Path parameters" id="path-params">
            <SchemaTable rows={paramRows(pathParams)} />
          </Section>
        )}
        {queryParams.length > 0 && (
          <Section title="Query parameters" id="query-params">
            <SchemaTable rows={paramRows(queryParams)} />
          </Section>
        )}
        {headerParams.length > 0 && (
          <Section title="Headers" id="header-params">
            <SchemaTable rows={paramRows(headerParams)} />
          </Section>
        )}

        {op.body && (
          <Section title="Request body" id="request-body">
            <p className="mb-3 text-[13.5px] text-muted-foreground">
              <code className="font-mono">{op.body.contentType}</code>
              {op.body.required ? ' · required' : ' · optional'}
            </p>
            {op.body.contentType === 'application/json' ? (
              <SchemaTable
                rows={rowsOf(spec.raw, op.body.schema)}
                empty="The body has no fields."
              />
            ) : (
              <Callout tone="info">
                Send the file’s raw bytes as the request body with the matching{' '}
                <code className="font-mono">Content-Type</code>.
              </Callout>
            )}
          </Section>
        )}

        <Section title="Responses" id="responses">
          <ul className="overflow-hidden rounded-lg border border-border">
            {op.responses.map((r) => (
              <li key={r.status} className="border-b border-border last:border-b-0">
                <details className="group" open={r === success}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface">
                    <span
                      className={cn('font-mono text-[13px] font-semibold', statusTone(r.status))}
                    >
                      {r.status}
                    </span>
                    <span className="flex-1 text-[14px]">
                      {r.description || STATUS_TEXT[r.status]}
                    </span>
                    {r.schema && (
                      <ArrowRight
                        className="size-4 text-subtle-foreground transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                    )}
                  </summary>
                  {r.schema && r.contentType === 'application/json' && (
                    <div className="border-t border-border p-4">
                      <SchemaTable rows={rowsOf(spec.raw, r.schema)} />
                      {!r.status.startsWith('2') && (
                        <p className="mt-3 text-[13px] text-muted-foreground">
                          See{' '}
                          <Link to="/docs/api/errors" className="text-blue hover:underline">
                            Errors
                          </Link>{' '}
                          for the format.
                        </p>
                      )}
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </Section>
      </article>

      <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div
            role="tablist"
            aria-label="Code language"
            className="flex gap-1 border-b border-border px-2 pt-2"
          >
            {LANGS.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={lang === l.id}
                onClick={() => setLang(l.id)}
                className={cn(
                  '-mb-px rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                  lang === l.id
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <CodeBlock bare lang={hl} code={code} className="rounded-none border-0 bg-transparent" />
        </div>
        {successExample && (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="label-14">Example response</span>
              <span
                className={cn('font-mono text-[12px] font-semibold', statusTone(success!.status))}
              >
                {success!.status}
              </span>
            </div>
            <CodeBlock
              bare
              lang="json"
              code={successExample}
              className="max-h-[420px] overflow-y-auto rounded-none border-0 bg-transparent"
            />
          </div>
        )}
        <p className="mt-3 text-[12.5px] leading-5 text-subtle-foreground">
          Examples are generated from the API description. Replace{' '}
          <code className="font-mono">app.example.com</code> and the key with your own.
        </p>
      </aside>
    </div>
  );
}
