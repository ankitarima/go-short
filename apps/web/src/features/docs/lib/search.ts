import { PAGES, type DocPage } from './content';
import { allOperations, operationPath, type Spec } from './openapi';

export interface SearchEntry {
  title: string;
  subtitle: string;
  group: 'Guides' | 'API reference';
  path: string;
  /** Lower-cased text used for matching, split into weighted fields. */
  title_l: string;
  heads_l: string;
  body_l: string;
  method?: string;
}

const clean = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

export function buildIndex(pages: DocPage[], spec: Spec | undefined): SearchEntry[] {
  const out: SearchEntry[] = pages.map((p) => ({
    title: p.title,
    subtitle: p.description,
    group: p.area === 'api' ? 'API reference' : 'Guides',
    path: p.path,
    title_l: p.title.toLowerCase(),
    heads_l: p.headings.map((h) => h.text.toLowerCase()).join(' '),
    body_l: clean(p.body),
  }));
  if (spec) {
    for (const op of allOperations(spec)) {
      out.push({
        title: op.summary,
        subtitle: `${op.method.toUpperCase()} ${op.path}`,
        group: 'API reference',
        path: operationPath(op),
        method: op.method,
        title_l: `${op.summary} ${op.method} ${op.path}`.toLowerCase(),
        heads_l: op.tag.toLowerCase(),
        body_l: clean(op.description),
      });
    }
  }
  return out;
}

/** Every query word must appear somewhere; title hits count most, then headings, then body. */
export function search(index: SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<[number, SearchEntry]> = [];
  for (const e of index) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const t = e.title_l.includes(w) ? (e.title_l.startsWith(w) ? 12 : 8) : 0;
      const h = e.heads_l.includes(w) ? 4 : 0;
      const b = e.body_l.includes(w) ? 1 : 0;
      if (!t && !h && !b) {
        ok = false;
        break;
      }
      score += t + h + b;
    }
    if (ok) scored.push([score, e]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title))
    .slice(0, limit)
    .map(([, e]) => e);
}

export const defaultIndex = (spec?: Spec): SearchEntry[] => buildIndex(PAGES, spec);
