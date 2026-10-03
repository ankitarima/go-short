import { Link as LinkIcon, Info, Lightbulb, TriangleAlert } from 'lucide-react';
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { cn } from '@go-short/ui/lib/cn';
import { CodeBlock } from './CodeBlock';
import { slugify, uniqueId } from './lib/content';

const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) =>
      typeof c === 'string' || typeof c === 'number'
        ? String(c)
        : isValidElement<{ children?: ReactNode }>(c)
          ? textOf(c.props.children)
          : '',
    )
    .join('');

const CALLOUT = {
  NOTE: { icon: Info, cls: 'border-blue/30 bg-blue-soft', title: 'Note' },
  TIP: { icon: Lightbulb, cls: 'border-green/30 bg-green-soft', title: 'Tip' },
  WARNING: { icon: TriangleAlert, cls: 'border-amber/40 bg-amber-soft', title: 'Warning' },
} as const;

function Heading({ level, id, children }: { level: 2 | 3; id: string; children: ReactNode }) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag
      id={id}
      className={cn(
        'group scroll-mt-24 font-semibold tracking-[-0.02em]',
        level === 2
          ? 'mt-12 border-b border-border pb-2 text-[22px] leading-8 first:mt-0'
          : 'mt-8 text-[17px] leading-7',
      )}
    >
      {children}
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="ml-2 inline-block align-middle text-subtle-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        <LinkIcon className="size-4" />
      </a>
    </Tag>
  );
}

export function Markdown({ source }: { source: string }) {
  // Heading ids are assigned in render order, exactly like the table of contents builds them.
  const seen = new Map<string, number>();
  const components: Components = {
    h2: ({ children }) => (
      <Heading level={2} id={uniqueId(slugify(textOf(children)), seen)}>
        {children}
      </Heading>
    ),
    h3: ({ children }) => (
      <Heading level={3} id={uniqueId(slugify(textOf(children)), seen)}>
        {children}
      </Heading>
    ),
    p: ({ children }) => (
      <p className="my-4 text-[15px] leading-7 text-foreground/90">{children}</p>
    ),
    a: ({ href = '', children }) =>
      href.startsWith('/') ? (
        <Link to={href} className="font-medium text-blue underline-offset-2 hover:underline">
          {children}
        </Link>
      ) : href.startsWith('#') ? (
        <a href={href} className="font-medium text-blue underline-offset-2 hover:underline">
          {children}
        </a>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-blue underline-offset-2 hover:underline"
        >
          {children}
        </a>
      ),
    ul: ({ children }) => (
      <ul className="my-4 list-disc space-y-1.5 pl-6 text-[15px] leading-7 marker:text-subtle-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-4 list-decimal space-y-1.5 pl-6 text-[15px] leading-7 marker:text-subtle-foreground">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,
    hr: () => <hr className="my-10 border-border" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    table: ({ children }) => (
      <div className="my-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-[14px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-surface text-[13px] text-muted-foreground">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border-b border-border px-4 py-2.5 font-medium">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border px-4 py-2.5 align-top leading-6 last:border-b-0">
        {children}
      </td>
    ),
    code: ({ children, className }) => (
      // Block code is rendered by `pre`; this is inline code.
      <code
        className={cn(
          'rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[13px]',
          className,
        )}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => {
      const child = Children.toArray(children)[0];
      const props = isValidElement<{ className?: string; children?: ReactNode }>(child)
        ? child.props
        : {};
      const lang = /language-(\w+)/.exec(props.className ?? '')?.[1] ?? 'text';
      return (
        <CodeBlock className="my-5" lang={lang} code={textOf(props.children).replace(/\n$/, '')} />
      );
    },
    blockquote: ({ children }) => {
      // Markdown puts whitespace-only strings between the blocks of a quote; they are not content.
      const items = Children.toArray(children).filter((c) => !(typeof c === 'string' && !c.trim()));
      const first = textOf(items[0]).trimStart();
      const m = /^\[!(NOTE|TIP|WARNING)\]/.exec(first);
      if (!m)
        return (
          <blockquote className="my-5 border-l-2 border-border-strong pl-4 text-muted-foreground">
            {children}
          </blockquote>
        );
      const kind = CALLOUT[m[1] as keyof typeof CALLOUT];
      const Icon = kind.icon;
      // Drop the "[!NOTE]" marker from the first paragraph.
      const body = items.map((c, i) =>
        i === 0 && isValidElement<{ children?: ReactNode }>(c) ? (
          <p key={i} className="my-0 text-[14px] leading-6">
            {stripMarker(c.props.children)}
          </p>
        ) : (
          c
        ),
      );
      return (
        <aside className={cn('my-6 flex gap-3 rounded-lg border p-4', kind.cls)} role="note">
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 [&>p+p]:mt-2">
            <div className="label-14 mb-1">{kind.title}</div>
            {body}
          </div>
        </aside>
      );
    },
  };
  return (
    <div className="docs-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

function stripMarker(children: ReactNode): ReactNode {
  const arr = Children.toArray(children);
  const [first, ...rest] = arr;
  if (typeof first === 'string')
    return [first.replace(/^\s*\[!(NOTE|TIP|WARNING)\]\s*/, ''), ...rest];
  return arr;
}
