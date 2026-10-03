import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAGES } from '@/features/docs/lib/content';
import { renderApp } from '@/test/render';
import { http, server } from '@/test/server';
import { PRODUCTS, RESOURCES, SOLUTIONS, productHref, solutionHref } from './data';
import { PRODUCT_CONTENT, SOLUTION_CONTENT } from './content';

// Signed out visitors: the default /me handler returns a user, so most tests override it.
const anonymous = () =>
  server.use(
    http.get(
      '/api/v1/me',
      () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAUTHENTICATED', message: 'Sign in' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    ),
  );

describe('marketing site structure', () => {
  it('every product and solution has content, and every link target exists', () => {
    const docPaths = new Set(PAGES.map((p) => p.path));
    for (const p of PRODUCTS) expect(PRODUCT_CONTENT[p.slug], p.slug).toBeDefined();
    for (const s of SOLUTIONS) expect(SOLUTION_CONTENT[s.slug], s.slug).toBeDefined();
    for (const r of RESOURCES)
      expect(r.href === '/security' || r.href === '/docs/api' || docPaths.has(r.href), r.href).toBe(
        true,
      );
    for (const c of Object.values(PRODUCT_CONTENT))
      for (const s of c.splits) if (s.link) expect(docPaths.has(s.link.to), s.link.to).toBe(true);
  });
});

describe('marketing pages', () => {
  it('home is public, shows the three products and calls signed-out visitors to sign up', async () => {
    anonymous();
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /links, campaigns and analytics/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Get started' })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    for (const p of PRODUCTS)
      expect(screen.getAllByRole('link', { name: new RegExp(p.name) }).length).toBeGreaterThan(0);
    expect(document.title).toMatch(/goShort/);
  });

  it('signed-in visitors see Dashboard instead of sign-up', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    expect((await screen.findAllByRole('link', { name: 'Dashboard' }))[0]).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('the product tabs on the home page switch the preview', async () => {
    anonymous();
    const { user } = renderApp('/');
    await screen.findByRole('tablist', { name: 'Products' });
    await user.click(screen.getByRole('tab', { name: /goAnalytics/ }));
    expect(screen.getByRole('tab', { name: /goAnalytics/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByText(/Illustrative interface\. Privacy-friendly click and scan analytics/),
    ).toBeInTheDocument();
  });

  it.each(PRODUCTS.map((p) => [p.name, productHref(p)] as const))(
    '%s page renders its sections',
    async (name, path) => {
      anonymous();
      renderApp(path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
      expect(
        screen.getByRole('heading', { name: 'Frequently asked questions' }),
      ).toBeInTheDocument();
      expect(document.title).toContain(name);
    },
  );

  it.each(SOLUTIONS.map((s) => [s.name, solutionHref(s)] as const))(
    '%s solution page renders',
    async (name, path) => {
      anonymous();
      renderApp(path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Up and running in three steps' }),
      ).toBeInTheDocument();
      expect(document.title).toContain(name);
    },
  );

  it('security page is honest about its limits', async () => {
    anonymous();
    renderApp('/security');
    expect(
      await screen.findByRole('heading', { name: /What we do not claim/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no two-factor authentication yet/i)).toBeInTheDocument();
  });

  it('unknown product and solution slugs show the not-found page', async () => {
    anonymous();
    const a = renderApp('/products/nothing');
    expect(await screen.findByText(/not found|doesn.t exist|404/i)).toBeInTheDocument();
    a.unmount();
    renderApp('/solutions/nothing');
    expect(await screen.findByText(/not found|doesn.t exist|404/i)).toBeInTheDocument();
  });

  it('the mega menu opens from the header and links to products, solutions and resources', async () => {
    anonymous();
    const { user } = renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('button', { name: 'Products' }));
    expect(
      (await screen.findAllByRole('link', { name: /goCampaigns/ })).some(
        (l) => l.getAttribute('href') === '/products/gocampaigns',
      ),
    ).toBe(true);
    await user.click(within(nav).getByRole('button', { name: 'Resources' }));
    expect(
      (await screen.findAllByRole('link', { name: /API reference/ })).some(
        (l) => l.getAttribute('href') === '/docs/api',
      ),
    ).toBe(true);
  });
});
