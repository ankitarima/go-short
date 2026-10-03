import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { buildOpenApi } from '../../../../api/src/openapi/build';
import { PAGES, extractHeadings, findPage, parseFrontmatter, slugify } from './lib/content';
import {
  allOperations,
  constraintsOf,
  exampleOf,
  parseSpec,
  rowsOf,
  sampleFor,
  snippet,
  typeLabel,
  type Json,
} from './lib/openapi';
import { buildIndex, search } from './lib/search';

// The real document the API serves, so the reference can never drift from the API.
const raw = buildOpenApi('https://app.example.com').document as unknown as Json;
const spec = parseSpec(raw);
const serveSpec = () => server.use(http.get('/openapi.json', () => HttpResponse.json(raw)));

describe('guides content', () => {
  it('every page has front matter, a unique path and a description', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(15);
    const paths = PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of PAGES) {
      expect(p.title, p.path).toBeTruthy();
      expect(p.description, p.path).toBeTruthy();
      expect(p.body.trim().length, p.path).toBeGreaterThan(200);
    }
  });

  it('every internal link points at a page or resource that exists', () => {
    const known = new Set<string>([
      ...PAGES.map((p) => p.path),
      ...spec.tags.map((t) => `/docs/api/${t.slug}`),
      '/docs',
      '/docs/api',
    ]);
    for (const p of PAGES) {
      for (const m of p.body.matchAll(/\]\((\/docs[^)#\s]*)(#[^)]*)?\)/g)) {
        expect(known.has(m[1]!), `${p.path} links to ${m[1]}`).toBe(true);
      }
    }
  });

  it('code fences are balanced and callouts use a known kind', () => {
    for (const p of PAGES) {
      expect((p.body.match(/^```/gm) ?? []).length % 2, p.path).toBe(0);
      for (const m of p.body.matchAll(/\[!(\w+)\]/g))
        expect(['NOTE', 'TIP', 'WARNING'], p.path).toContain(m[1]);
    }
  });

  it('parses front matter and builds heading ids like the renderer (duplicates get a suffix)', () => {
    expect(parseFrontmatter('---\ntitle: A\narea: api\n---\nbody')).toEqual({
      data: { title: 'A', area: 'api' },
      body: 'body',
    });
    expect(slugify('Verify the `signature`!')).toBe('verify-the-signature');
    const h = extractHeadings('## One\n```\n## not a heading\n```\n### Two\n## One');
    expect(h.map((x) => x.id)).toEqual(['one', 'two', 'one-1']);
  });

  it('documented UI labels exist in the product (guards against instructions that rot)', () => {
    expect(findPage('guides', 'quickstart')!.body).toContain('Create link');
  });
});

describe('API description reader', () => {
  const ops = allOperations(spec);

  it('shows exactly the operations an API key can call, with unique slugs per resource', () => {
    expect(ops.length).toBe(32);
    for (const o of ops) {
      expect(o.path.startsWith('/api/v1/')).toBe(true);
      expect(o.path).not.toContain('{workspaceId}');
      expect(o.path).not.toContain('/admin');
    }
    for (const t of spec.tags)
      expect(new Set(t.operations.map((o) => o.slug)).size).toBe(t.operations.length);
    expect(spec.tags.map((t) => t.name)).not.toContain('Admin');
    expect(spec.tags.map((t) => t.name)).not.toContain('Webhooks');
  });

  it('pulls the required permission out of the description', () => {
    const create = ops.find((o) => o.method === 'post' && o.path === '/api/v1/links')!;
    expect(create.permission).toMatch(/^links:write/);
    expect(create.description).not.toContain('Required permission');
  });

  it('describes types, nullability and limits', () => {
    const create = ops.find((o) => o.method === 'post' && o.path === '/api/v1/links')!;
    const rows = rowsOf(raw, create.body!.schema);
    const dest = rows.find((r) => r.name === 'destinationUrl')!;
    expect(dest).toMatchObject({ type: 'string', required: true });
    expect(dest.constraints).toContain('max length 2048');
    expect(rows.find((r) => r.name === 'title')!.type).toBe('string | null');
    expect(typeLabel(raw, { type: 'array', items: { type: 'integer' } })).toBe('integer[]');
    expect(constraintsOf(raw, { type: 'integer', minimum: 1, maximum: 100, default: 50 })).toEqual([
      'min 1',
      'max 100',
      'default 50',
    ]);
  });

  it('resolves $ref and survives self-referencing schemas', () => {
    const cyc: Json = {
      components: {
        schemas: {
          Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
        },
      },
    };
    expect(() => rowsOf(cyc, { $ref: '#/components/schemas/Node' })).not.toThrow();
    expect(
      JSON.stringify(exampleOf(cyc, { $ref: '#/components/schemas/Node' })).length,
    ).toBeLessThan(200); // bounded, not infinite
  });

  it('generates examples without leaking placeholders into required fields', () => {
    const create = ops.find((o) => o.method === 'post' && o.path === '/api/v1/links')!;
    const s = sampleFor(spec, create);
    expect(s.body).toEqual({ destinationUrl: 'https://example.com/summer-sale' });
    expect(s.url).toBe('https://app.example.com/api/v1/links');
  });

  it('builds valid snippets in every language, with the key from the environment', () => {
    const create = ops.find((o) => o.method === 'post' && o.path === '/api/v1/links')!;
    const s = sampleFor(spec, create);
    const curl = snippet('curl', s);
    expect(curl).toContain('-X POST');
    expect(curl).toContain('$GOSHORT_API_KEY');
    expect(curl).toContain(`-d '{"destinationUrl":"https://example.com/summer-sale"}'`);
    expect(snippet('javascript', s)).toContain('process.env.GOSHORT_API_KEY');
    const py = snippet('python', s);
    expect(py).toContain('requests.post(');
    expect(py).toContain("os.environ['GOSHORT_API_KEY']");
    for (const o of ops)
      for (const l of ['curl', 'javascript', 'python'] as const)
        expect(snippet(l, sampleFor(spec, o)).length).toBeGreaterThan(20);
    // No real secret-looking value in any sample.
    expect(snippet('curl', s)).not.toMatch(/gs_[A-Za-z0-9_-]{8}_/);
  });
});

describe('search', () => {
  const index = buildIndex(PAGES, spec);
  it('finds guides, headings and endpoints, best match first', () => {
    expect(search(index, 'webhook')[0]!.path).toBe('/docs/webhooks');
    expect(
      search(index, 'create a link').some((r) =>
        r.path.startsWith('/docs/api/links/create-a-link'),
      ),
    ).toBe(true);
    expect(search(index, 'signature').map((r) => r.path)).toContain('/docs/webhooks');
    expect(search(index, 'zzzzqqqq')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });
});

describe('documentation site', () => {
  it('is public: a guide renders without signing in, with a table of contents', async () => {
    serveSpec();
    renderApp('/docs/short-links');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Short links' }),
    ).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(toc).getByRole('link', { name: 'Redirect types' })).toHaveAttribute(
      'href',
      '#redirect-types',
    );
    expect(document.getElementById('redirect-types')).toBeInTheDocument();
  });

  it('/docs redirects to the first guide and the header switches between Guides and API reference', async () => {
    serveSpec();
    const { user } = renderApp('/docs');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Introduction' }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('link', { name: /API reference/ })[0]!);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'API introduction' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Resources')).toBeInTheDocument();
  });

  it('renders a callout and a code block with a copy button', async () => {
    serveSpec();
    renderApp('/docs/webhooks');
    expect(await screen.findByRole('heading', { level: 1, name: 'Webhooks' })).toBeInTheDocument();
    expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copy code' }).length).toBeGreaterThan(0);
  });

  it('shows an operation: method, path, parameters, body, responses and samples', async () => {
    serveSpec();
    const { user } = renderApp('/docs/api/links/create-a-link');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create a link' }),
    ).toBeInTheDocument();
    expect(screen.getByText('/api/v1/links')).toBeInTheDocument();
    expect(screen.getByText('destinationUrl')).toBeInTheDocument();
    expect(screen.getAllByText('required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('201').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Authorization: Bearer/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Python' }));
    expect(await screen.findByText(/requests\.post/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a resource page lists its endpoints, and unknown pages say so', async () => {
    serveSpec();
    const a = renderApp('/docs/api/links');
    expect(await screen.findByRole('heading', { level: 1, name: 'Links' })).toBeInTheDocument();
    expect(screen.getAllByText('Create a link').length).toBeGreaterThan(0);
    a.unmount();
    renderApp('/docs/nope');
    expect(await screen.findByText('This page does not exist')).toBeInTheDocument();
  });

  it('keeps working when the API description cannot be loaded (guides unaffected, reference explains)', async () => {
    server.use(http.get('/openapi.json', () => new HttpResponse(null, { status: 500 })));
    const a = renderApp('/docs/introduction');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Introduction' }),
    ).toBeInTheDocument();
    a.unmount();
    renderApp('/docs/api/links/create-a-link');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/api description/i));
  });

  it('search opens with the keyboard and jumps to a result', async () => {
    serveSpec();
    const { user } = renderApp('/docs/introduction');
    await screen.findByRole('heading', { level: 1, name: 'Introduction' });
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'webhooks');
    await user.click(await screen.findByRole('option', { name: /Webhooks/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Webhooks' })).toBeInTheDocument();
  });
});
