import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import { useMemo } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/cn';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);

const ALIAS: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  js: 'javascript',
  py: 'python',
  ts: 'javascript',
};
const LABEL: Record<string, string> = {
  bash: 'Shell',
  javascript: 'JavaScript',
  json: 'JSON',
  python: 'Python',
  text: 'Text',
};

export function CodeBlock({
  code,
  lang = 'text',
  className,
  bare = false,
}: {
  code: string;
  lang?: string;
  className?: string;
  /** No header: used inside panels that supply their own tabs. */
  bare?: boolean;
}) {
  const language = ALIAS[lang] ?? lang;
  const html = useMemo(() => {
    if (!hljs.getLanguage(language)) return null;
    try {
      // highlight.js escapes the source, so the markup it returns is safe to inject.
      return hljs.highlight(code, { language }).value;
    } catch {
      return null;
    }
  }, [code, language]);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border border-border bg-surface',
        className,
      )}
    >
      {!bare && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="label-12 text-subtle-foreground">{LABEL[language] ?? language}</span>
          <CopyButton value={code} label="Copy code" />
        </div>
      )}
      {bare && (
        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton value={code} label="Copy code" size="icon" />
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        {html ? (
          <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="font-mono">{code}</code>
        )}
      </pre>
    </div>
  );
}
