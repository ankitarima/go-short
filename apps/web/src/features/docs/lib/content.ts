// Guides are Markdown files in ../content, bundled at build time. Front matter:
//   title, description, area (guides | api), section, order, slug (optional; default: file name)

export type Area = 'guides' | 'api';

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface DocPage {
  slug: string;
  path: string;
  title: string;
  description: string;
  area: Area;
  section: string;
  order: number;
  body: string;
  headings: Heading[];
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Strips the inline Markdown that must not appear in a heading's id or text. */
const plain = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();

export function parseFrontmatter(src: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: src.slice(m[0].length) };
}

/** h2/h3 headings outside code fences, with the same ids the renderer gives them. */
export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const text = plain(m[2]!);
    out.push({ id: uniqueId(slugify(text), seen), text, level: m[1]!.length as 2 | 3 });
  }
  return out;
}

export function uniqueId(base: string, seen: Map<string, number>): string {
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export const pagePath = (area: Area, slug: string): string =>
  area === 'api' ? (slug === 'introduction' ? '/docs/api' : `/docs/api/${slug}`) : `/docs/${slug}`;

export function buildPages(files: Record<string, string>): DocPage[] {
  const pages: DocPage[] = [];
  for (const [file, src] of Object.entries(files)) {
    const { data, body } = parseFrontmatter(src);
    const fileSlug = file.split('/').pop()!.replace(/\.md$/, '');
    const area = (data.area === 'api' ? 'api' : 'guides') as Area;
    const slug = data.slug || fileSlug;
    pages.push({
      slug,
      path: pagePath(area, slug),
      title: data.title ?? slug,
      description: data.description ?? '',
      area,
      section: data.section ?? 'Guides',
      order: Number(data.order ?? 99),
      body,
      headings: extractHeadings(body),
    });
  }
  return pages.sort((a, b) => a.order - b.order);
}

const files = import.meta.glob('../content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const PAGES: DocPage[] = buildPages(files);

export const pagesOf = (area: Area): DocPage[] => PAGES.filter((p) => p.area === area);

export const findPage = (area: Area, slug: string): DocPage | undefined =>
  PAGES.find((p) => p.area === area && p.slug === slug);

/** Pages grouped by their `section`, in order of first appearance. */
export function sections(area: Area): Array<{ name: string; pages: DocPage[] }> {
  const out: Array<{ name: string; pages: DocPage[] }> = [];
  for (const p of pagesOf(area)) {
    let s = out.find((x) => x.name === p.section);
    if (!s) out.push((s = { name: p.section, pages: [] }));
    s.pages.push(p);
  }
  return out;
}
