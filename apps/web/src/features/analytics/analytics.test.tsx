import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { analytics, makeLink, makeMe } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { apiError, http, ok, server } from '@/test/server';

function watch(overrides?: Partial<typeof analytics>) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(
      '/api/v1/workspaces/ws_1/analytics',
      ({ request }) => (
        seen.push(new URL(request.url).searchParams),
        ok({ ...analytics, ...overrides })
      ),
    ),
  );
  return seen;
}

describe('analytics page', () => {
  it('renders the summary, breakdowns and top links from the API', async () => {
    watch();
    renderApp('/analytics');
    expect(await screen.findByText('1,200')).toBeInTheDocument(); // clicks
    expect(screen.getByText('900')).toBeInTheDocument(); // uniques
    expect(screen.getByText('Approximate')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument(); // country code -> name
    expect(screen.getAllByText('Mobile')[0]).toBeInTheDocument(); // device humanized
    expect(screen.getByText('(direct)')).toBeInTheDocument();
    expect(screen.getByText('Poster')).toBeInTheDocument(); // QR code name
    expect(screen.getByText('go.example.com/sale')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Clicks over time' })).toBeInTheDocument();
  });

  it('requests the last 30 days by default and the right range when a preset changes', async () => {
    const seen = watch();
    const { user } = renderApp('/analytics');
    await screen.findByText('1,200');
    const first = seen.at(-1)!;
    expect(first.get('granularity')).toBe('day');
    expect(first.get('includeBots')).toBe('true');
    const days = (Date.parse(first.get('to')!) - Date.parse(first.get('from')!)) / 86_400_000 + 1;
    expect(days).toBe(30);
    await user.click(screen.getByRole('radio', { name: '7d' }));
    await waitFor(() =>
      expect(
        (Date.parse(seen.at(-1)!.get('to')!) - Date.parse(seen.at(-1)!.get('from')!)) / 86_400_000 +
          1,
      ).toBe(7),
    );
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(seen.at(-1)!.get('granularity')).toBe('hour'));
    expect(seen.at(-1)!.get('from')).toBe(seen.at(-1)!.get('to'));
  });

  it('sends device, country, link and bot filters; ignores an incomplete country code', async () => {
    const seen = watch();
    server.use(
      http.get('/api/v1/workspaces/ws_1/links', () => ok([makeLink()], { nextCursor: null })),
    );
    const { user } = renderApp('/analytics');
    await screen.findByText('1,200');
    await user.selectOptions(screen.getByLabelText('Device'), 'MOBILE');
    await waitFor(() => expect(seen.at(-1)!.get('device')).toBe('MOBILE'));
    await user.type(screen.getByLabelText('Country'), 'i');
    expect(seen.at(-1)!.get('country')).toBeNull(); // one letter is not a code yet
    await user.type(screen.getByLabelText('Country'), 'n');
    await waitFor(() => expect(seen.at(-1)!.get('country')).toBe('IN'));
    await user.click(screen.getByRole('switch', { name: 'Include bots' }));
    await waitFor(() => expect(seen.at(-1)!.get('includeBots')).toBe('false'));
    await waitFor(() => expect(screen.getByRole('option', { name: '/sale' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Link'), 'l_1');
    await waitFor(() => expect(seen.at(-1)!.get('linkId')).toBe('l_1'));
  });

  it('offers CSV export to members and above, not to viewers', async () => {
    watch();
    const a = renderApp('/analytics');
    await screen.findByText('1,200');
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    a.unmount();
    server.use(http.get('/api/v1/me', () => ok(makeMe('VIEWER'))));
    renderApp('/analytics');
    await screen.findByText('1,200');
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('explains accuracy and shows the API error with retry', async () => {
    watch();
    const a = renderApp('/analytics');
    await screen.findByText('1,200');
    await a.user.click(screen.getByText('About these numbers'));
    expect(await screen.findByText('Unique visitors are approximate.')).toBeInTheDocument();
    a.unmount();

    let fail = true;
    server.use(
      http.get('/api/v1/workspaces/ws_1/analytics', () =>
        fail
          ? apiError(400, 'VALIDATION_ERROR', 'Country/device filters are limited to 31 days')
          : ok(analytics),
      ),
    );
    const b = renderApp('/analytics');
    expect(await screen.findByRole('alert')).toHaveTextContent('limited to 31 days');
    fail = false;
    await b.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1,200')).toBeInTheDocument();
  });

  it('shows a clear empty chart message when there are no clicks', async () => {
    watch({
      summary: { clicks: 0, humanClicks: 0, botClicks: 0, uniqueVisitors: 0, qrScans: 0 },
      timeline: [{ date: '2026-09-01', clicks: 0, humanClicks: 0, botClicks: 0 }],
      countries: [],
      devices: [],
      referrers: [],
      topLinks: [],
      qrCodes: [],
      utmSources: [],
      cities: [],
      browsers: [],
      os: [],
    });
    renderApp('/analytics');
    expect(await screen.findByText('No clicks in this period')).toBeInTheDocument();
    expect(screen.getAllByText('No data yet').length).toBeGreaterThan(0);
    void within;
  });
});
