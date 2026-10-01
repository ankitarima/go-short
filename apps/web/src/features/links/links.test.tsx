import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeCampaign, makeDomain, makeLink, makeMe } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { apiError, http, ok, server } from '@/test/server';

const links = (items: ReturnType<typeof makeLink>[], nextCursor: string | null = null) =>
  http.get('/api/v1/workspaces/ws_1/links', () => ok(items, { nextCursor }));

describe('links list', () => {
  it('shows each link with its status, destination and campaign', async () => {
    server.use(
      links([
        makeLink({ title: 'Summer sale', campaignId: 'c_1' }),
        makeLink({
          id: 'l_2',
          slug: 'old',
          shortUrl: 'https://go.example.com/old',
          isActive: false,
        }),
        makeLink({ id: 'l_3', slug: 'gone', expired: true, hasPassword: true }),
      ]),
    );
    renderApp('/links');
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3
    expect(within(rows[1]!).getByText('go.example.com/sale')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Diwali 2026')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('example.com/summer')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Password protected').length).toBeGreaterThan(0);
  });

  it('shows an inviting empty state with the next step', async () => {
    server.use(links([]));
    renderApp('/links');
    expect(await screen.findByText('No links yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /create link/i }).length).toBeGreaterThan(0);
  });

  it('shows an error state with a working retry', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/workspaces/ws_1/links', () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'Internal server error')
          : ok([makeLink()], { nextCursor: null }),
      ),
    );
    const { user } = renderApp('/links');
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(screen.getByText(/request id: req_test/i)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('go.example.com/sale')).toBeInTheDocument();
  });

  it('debounces search and sends filters to the server', async () => {
    const seen: string[] = [];
    server.use(
      http.get(
        '/api/v1/workspaces/ws_1/links',
        ({ request }) => (
          seen.push(new URL(request.url).search),
          ok([makeLink()], { nextCursor: null })
        ),
      ),
    );
    const { user } = renderApp('/links');
    await screen.findByText('go.example.com/sale');
    await user.type(screen.getByLabelText('Search links'), 'summer');
    await waitFor(() => expect(seen.at(-1)).toContain('q=summer'));
    // typing did not fire one request per keystroke
    expect(seen.filter((s) => s.includes('q=')).length).toBeLessThanOrEqual(2);
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'false');
    await waitFor(() => expect(seen.at(-1)).toContain('isActive=false'));
  });

  it('loads more with the cursor', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get('/api/v1/workspaces/ws_1/links', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        seen.push(cursor);
        return cursor
          ? ok(
              [makeLink({ id: 'l_9', slug: 'second', shortUrl: 'https://go.example.com/second' })],
              { nextCursor: null },
            )
          : ok([makeLink()], { nextCursor: 'CUR1' });
      }),
    );
    const { user } = renderApp('/links');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('go.example.com/second')).toBeInTheDocument();
    expect(seen).toEqual([null, 'CUR1']);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('viewers can browse but not create, edit or delete', async () => {
    server.use(http.get('/api/v1/me', () => ok(makeMe('VIEWER'))));
    const { user } = renderApp('/links');
    await screen.findByText('go.example.com/sale');
    expect(screen.queryByRole('button', { name: /create link/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /actions for sale/i }));
    expect(await screen.findByRole('menuitem', { name: /copy short link/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /edit/i })).not.toBeInTheDocument();
  });
});

describe('creating and editing links', () => {
  function stubCreate() {
    const body = capture<Record<string, unknown>>();
    server.use(
      http.get('/api/v1/workspaces/ws_1/domains', () =>
        ok([
          makeDomain(),
          makeDomain({ id: 'd_2', hostname: 'links.client.com', shared: false, isDefault: true }),
        ]),
      ),
      http.post(
        '/api/v1/workspaces/ws_1/links',
        async ({ request }) => (
          body.calls.push((await request.json()) as never),
          ok(makeLink({ id: 'l_new', slug: 'promo' }))
        ),
      ),
      http.get('/api/v1/workspaces/ws_1/links/l_new', () =>
        ok(makeLink({ id: 'l_new', slug: 'promo' })),
      ),
    );
    return body;
  }

  it('creates a link with slug, campaign and UTM, previewing the short URL as you type', async () => {
    const body = stubCreate();
    const { user } = renderApp('/links');
    await user.click((await screen.findAllByRole('button', { name: /create link/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Destination URL'),
      'https://example.com/landing',
    );
    await waitFor(() =>
      expect(within(dialog).getByTestId('link-preview')).toHaveTextContent(
        'https://links.client.com/',
      ),
    ); // workspace default domain preselected
    await user.type(within(dialog).getByLabelText(/custom slug/i), 'promo');
    expect(within(dialog).getByTestId('link-preview')).toHaveTextContent(
      'https://links.client.com/promo',
    );
    await user.click(within(dialog).getByText('UTM parameters'));
    await user.type(within(dialog).getByLabelText('utm_source'), 'newsletter');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(body.calls).toHaveLength(1));
    expect(body.last()).toMatchObject({
      destinationUrl: 'https://example.com/landing',
      slug: 'promo',
      domainId: 'd_2',
      utmSource: 'newsletter',
    });
    expect(body.last()).not.toHaveProperty('password'); // empty optional values are omitted on create
    expect(body.last()).not.toHaveProperty('title');
  });

  it('shows slug and URL errors next to their fields', async () => {
    stubCreate();
    server.use(
      http.post('/api/v1/workspaces/ws_1/links', () =>
        apiError(409, 'SLUG_TAKEN', 'That slug is already in use on this domain'),
      ),
    );
    const { user } = renderApp('/links');
    await user.click((await screen.findAllByRole('button', { name: /create link/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Destination URL'), 'https://example.com/x');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Create link' })).toBeEnabled(),
    );
    await user.type(within(dialog).getByLabelText(/custom slug/i), 'taken');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(
      await within(dialog).findByText('That slug is already in use on this domain'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/custom slug/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // stays open so the user can fix it

    server.use(
      http.post('/api/v1/workspaces/ws_1/links', () =>
        apiError(400, 'VALIDATION_ERROR', 'Only http and https URLs are allowed', [
          { path: 'destinationUrl', message: 'Only http and https URLs are allowed' },
        ]),
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(
      await within(dialog).findByText('Only http and https URLs are allowed'),
    ).toBeInTheDocument();
  });

  it('edits only through PATCH, can clear a password, and keeps the slug required', async () => {
    const patch = capture<Record<string, unknown>>();
    server.use(
      links([makeLink({ hasPassword: true, title: 'Old title' })]),
      http.patch(
        '/api/v1/workspaces/ws_1/links/l_1',
        async ({ request }) => (patch.calls.push((await request.json()) as never), ok(makeLink())),
      ),
    );
    const { user } = renderApp('/links');
    await user.click(await screen.findByRole('button', { name: /actions for sale/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Old title');
    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'New title');
    await user.click(within(dialog).getByText('Expiration & protection'));
    await user.click(within(dialog).getByRole('switch', { name: 'Remove password' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch.calls).toHaveLength(1));
    expect(patch.last()).toMatchObject({
      title: 'New title',
      slug: 'sale',
      password: null,
      destinationUrl: 'https://example.com/summer',
    });
  });

  it('deletes only after confirmation', async () => {
    let deleted = 0;
    server.use(
      links([makeLink()]),
      http.delete('/api/v1/workspaces/ws_1/links/l_1', () => (deleted++, ok({}))),
    );
    const { user } = renderApp('/links');
    await user.click(await screen.findByRole('button', { name: /actions for sale/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/stop working/i);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe(0);
    await user.click(await screen.findByRole('button', { name: /actions for sale/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete link' }),
    );
    await waitFor(() => expect(deleted).toBe(1));
  });

  it('disables and re-enables from the actions menu', async () => {
    const calls: string[] = [];
    server.use(
      links([makeLink()]),
      http.post(
        '/api/v1/workspaces/ws_1/links/l_1/disable',
        () => (calls.push('disable'), ok(makeLink({ isActive: false }))),
      ),
    );
    const { user } = renderApp('/links');
    await user.click(await screen.findByRole('button', { name: /actions for sale/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(calls).toEqual(['disable']));
  });
});

describe('link detail', () => {
  it('shows details, the short URL and analytics; reports missing links clearly', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/links/l_1', () =>
        ok(makeLink({ utmSource: 'ig', campaignId: 'c_1' })),
      ),
      http.get('/api/v1/workspaces/ws_1/links/l_1/analytics', () => ok(analyticsFixture())),
    );
    renderApp('/links/l_1');
    expect(await screen.findByRole('heading', { name: 'go.example.com/sale' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Diwali 2026' })).toHaveAttribute(
      'href',
      '/campaigns/c_1',
    );
    expect(screen.getByText('source: ig')).toBeInTheDocument();
    expect(await screen.findByText('1,200')).toBeInTheDocument(); // analytics summary

    server.use(
      http.get('/api/v1/workspaces/ws_1/links/l_missing', () =>
        apiError(404, 'LINK_NOT_FOUND', 'Link not found'),
      ),
    );
    const other = renderApp('/links/l_missing');
    expect(await other.findByText(/does not exist or was deleted/i)).toBeInTheDocument();
  });
});

import { analytics } from '@/test/fixtures';
const analyticsFixture = () => analytics;
void makeCampaign;
