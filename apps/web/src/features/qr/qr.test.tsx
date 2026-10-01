import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink, makeMe, makeQr } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { HttpResponse, http, ok, server } from '@/test/server';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function mocks() {
  const previews = capture<Record<string, unknown>>();
  const saves = capture<Record<string, unknown>>();
  server.use(
    http.get('/api/v1/workspaces/ws_1/qr', () => ok([makeQr()], { nextCursor: null })),
    http.post('/api/v1/workspaces/ws_1/qr/preview', async ({ request }) => {
      previews.calls.push((await request.json()) as never);
      return new HttpResponse(SVG, { headers: { 'content-type': 'image/svg+xml' } });
    }),
    http.post('/api/v1/workspaces/ws_1/qr', async ({ request }) => {
      saves.calls.push((await request.json()) as never);
      return ok(makeQr({ id: 'q_new' }));
    }),
    http.get('/api/v1/workspaces/ws_1/qr/q_new', () => ok(makeQr({ id: 'q_new' }))),
  );
  return { previews, saves };
}

describe('qr list', () => {
  it('shows saved QR codes and hides creation from viewers', async () => {
    mocks();
    server.use(http.get('/api/v1/me', () => ok(makeMe('VIEWER'))));
    renderApp('/qr');
    expect(await screen.findByText('Poster')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new qr/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new qr/i })).not.toBeInTheDocument();
  });
});

describe('qr designer', () => {
  it('renders a live preview from the stateless endpoint and saves the same settings', async () => {
    const { previews, saves } = mocks();
    const { user } = renderApp('/qr/new');
    await screen.findByRole('option', { name: /go\.example\.com\/sale/ });
    await waitFor(() => expect(previews.calls.some((c) => c.linkId === 'l_1')).toBe(true));
    expect(previews.last()).toMatchObject({
      linkId: 'l_1',
      format: 'png',
      foregroundColor: '#000000',
      backgroundColor: '#FFFFFF',
    });
    await user.type(screen.getByLabelText('Name'), 'Poster');
    await user.click(screen.getByRole('button', { name: 'Save QR code' }));
    await waitFor(() => expect(saves.calls).toHaveLength(1));
    expect(saves.last()).toMatchObject({
      name: 'Poster',
      linkId: 'l_1',
      campaignId: null,
      foregroundColor: '#000000',
    });
    expect(saves.last()).not.toHaveProperty('logoPath');
  });

  it('warns about unscannable colours and blocks saving and downloads', async () => {
    mocks();
    const { user } = renderApp('/qr/new');
    await screen.findByRole('option', { name: /go\.example\.com\/sale/ });
    await user.type(screen.getByLabelText('Name'), 'Poster');
    expect(screen.getByRole('button', { name: 'Save QR code' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Foreground'), { target: { value: '#CCCCCC' } });
    expect(await screen.findByText('This colour pair may not scan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save QR code' })).toBeDisabled();
  });

  it('requires a name before saving', async () => {
    mocks();
    renderApp('/qr/new');
    await screen.findByRole('option', { name: /go\.example\.com\/sale/ });
    expect(screen.getByRole('button', { name: 'Save QR code' })).toBeDisabled();
  });

  it('uploads a logo, forces error correction H and sends its path', async () => {
    const { saves } = mocks();
    server.use(
      http.post('/api/v1/workspaces/ws_1/qr/logos', () => ok({ logoPath: 'logos/abc.png' })),
    );
    const { user } = renderApp('/qr/new');
    await screen.findByRole('option', { name: /go\.example\.com\/sale/ });
    await user.type(screen.getByLabelText('Name'), 'Logo QR');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Upload logo'), file);
    expect(await screen.findByText('Logo uploaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save QR code' }));
    await waitFor(() => expect(saves.calls).toHaveLength(1));
    expect(saves.last()).toMatchObject({ logoPath: 'logos/abc.png', errorCorrection: 'H' });
  });

  it('an existing QR keeps its link fixed and reuses its saved logo by id', async () => {
    const { previews } = mocks();
    server.use(
      http.get('/api/v1/workspaces/ws_1/qr/q_9', () =>
        ok(makeQr({ id: 'q_9', hasLogo: true, errorCorrection: 'H' })),
      ),
    );
    renderApp('/qr/q_9');
    expect(await screen.findByText('Using the saved logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Link')).toBeDisabled();
    await waitFor(() => expect(previews.calls.some((c) => c.logoFrom === 'q_9')).toBe(true));
    expect(previews.calls.find((c) => c.logoFrom === 'q_9')).not.toHaveProperty('logoPath');
  });

  it('shows the link-less state', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/links', () =>
        ok([makeLink()].slice(1), { nextCursor: null }),
      ),
    );
    renderApp('/qr/new');
    expect(await screen.findByRole('option', { name: 'Create a link first' })).toBeInTheDocument();
  });
});
