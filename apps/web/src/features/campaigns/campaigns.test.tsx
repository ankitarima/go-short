import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeCampaign, makeLink, makeMe, makeQr } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { apiError, http, ok, server } from '@/test/server';

describe('campaigns', () => {
  it('lists campaigns with a factual status, link and QR counts', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/campaigns', () =>
        ok(
          [
            makeCampaign({ startDate: '2099-01-01T00:00:00Z' }),
            makeCampaign({
              id: 'c_2',
              name: 'Spring',
              endDate: '2020-01-01T00:00:00Z',
              linkCount: 1,
              qrCodeCount: 0,
            }),
          ],
          { nextCursor: null },
        ),
      ),
    );
    renderApp('/campaigns');
    expect(await screen.findByText('Diwali 2026')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getByText('Spring').closest('tr')).toHaveTextContent('1');
  });

  it('creates a campaign with dates and a default utm_campaign, validating the date range', async () => {
    const body = capture<Record<string, unknown>>();
    server.use(
      http.post(
        '/api/v1/workspaces/ws_1/campaigns',
        async ({ request }) => (
          body.calls.push((await request.json()) as never),
          ok(makeCampaign({ id: 'c_new', name: 'Launch' }))
        ),
      ),
      http.get('/api/v1/workspaces/ws_1/campaigns/c_new', () =>
        ok(makeCampaign({ id: 'c_new', name: 'Launch' })),
      ),
    );
    const { user } = renderApp('/campaigns');
    await user.click((await screen.findAllByRole('button', { name: /new campaign/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Launch');
    await user.type(within(dialog).getByLabelText('Start date'), '2026-10-20');
    await user.type(within(dialog).getByLabelText('End date'), '2026-10-01');
    expect(within(dialog).getByText(/end date cannot be before/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create campaign' })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('End date'));
    await user.type(within(dialog).getByLabelText('End date'), '2026-11-05');
    await user.type(within(dialog).getByLabelText('Default utm_campaign'), 'launch2026');
    await user.click(within(dialog).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(body.calls).toHaveLength(1));
    expect(body.last()).toMatchObject({
      name: 'Launch',
      startDate: '2026-10-20T00:00:00.000Z',
      utmCampaign: 'launch2026',
      description: null,
    });
    expect((body.last().endDate as string).startsWith('2026-11-05')).toBe(true);
  });

  it('deleting a campaign warns that links and QR codes are kept', async () => {
    let deleted = 0;
    server.use(
      http.get('/api/v1/workspaces/ws_1/campaigns', () =>
        ok([makeCampaign()], { nextCursor: null }),
      ),
      http.delete('/api/v1/workspaces/ws_1/campaigns/c_1', () => (deleted++, ok({}))),
    );
    const { user } = renderApp('/campaigns');
    await user.click(await screen.findByRole('button', { name: /actions for diwali 2026/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/3 links and 1 QR codes are kept/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    await waitFor(() => expect(deleted).toBe(1));
  });

  it('the detail page shows Campaign → Links → QR → Analytics together', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/campaigns/c_1', () =>
        ok(makeCampaign({ description: 'Festival push', startDate: '2026-10-01T00:00:00Z' })),
      ),
      http.get('/api/v1/workspaces/ws_1/links', ({ request }) =>
        ok(
          new URL(request.url).searchParams.get('campaignId') === 'c_1'
            ? [makeLink({ campaignId: 'c_1', utmSource: 'instagram', utmMedium: 'social' })]
            : [],
          { nextCursor: null },
        ),
      ),
      http.get('/api/v1/workspaces/ws_1/qr', () =>
        ok([makeQr({ campaignId: 'c_1' })], { nextCursor: null }),
      ),
      http.get('/api/v1/workspaces/ws_1/campaigns/c_1/analytics', () =>
        ok({
          ...JSON.parse(
            JSON.stringify({
              summary: {
                clicks: 321,
                humanClicks: 300,
                botClicks: 21,
                uniqueVisitors: 250,
                qrScans: 12,
              },
              timeline: [],
              countries: [],
              regions: [],
              cities: [],
              devices: [],
              browsers: [],
              os: [],
              referrers: [],
              utmSources: [],
              utmMediums: [],
              utmCampaigns: [],
              qrCodes: [],
              topLinks: [],
              meta: {
                timezone: 'UTC',
                from: 'a',
                to: 'b',
                granularity: 'day',
                includeBots: true,
                source: 'rollup',
                notes: [],
              },
            }),
          ),
        }),
      ),
    );
    const { user } = renderApp('/campaigns/c_1');
    expect(await screen.findByRole('heading', { name: 'Diwali 2026' })).toBeInTheDocument();
    expect(screen.getByText(/festival push/i)).toBeInTheDocument();
    expect(await screen.findByText('321')).toBeInTheDocument(); // campaign-scoped analytics
    expect(screen.getByLabelText('Campaign structure')).toHaveTextContent(/Links\s*3/);
    await user.click(screen.getByRole('tab', { name: /links/i }));
    expect(await screen.findByText('go.example.com/sale')).toBeInTheDocument();
    expect(screen.getByText('instagram / social')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /qr codes/i }));
    expect(await screen.findByRole('img', { name: /qr code for poster/i })).toBeInTheDocument();
  });

  it('viewers cannot create or edit campaigns', async () => {
    server.use(http.get('/api/v1/me', () => ok(makeMe('VIEWER'))));
    renderApp('/campaigns');
    await screen.findByText('Diwali 2026');
    expect(screen.queryByRole('button', { name: /new campaign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument();
  });

  it('a missing campaign shows the server message', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/campaigns/nope', () =>
        apiError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found'),
      ),
      http.get('/api/v1/workspaces/ws_1/campaigns/nope/analytics', () =>
        apiError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found'),
      ),
      http.get('/api/v1/workspaces/ws_1/qr', () => ok([], { nextCursor: null })),
    );
    renderApp('/campaigns/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign not found');
  });
});
