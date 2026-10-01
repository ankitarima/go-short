import { describe, expect, it, vi } from 'vitest';
import { apiError, http, HttpResponse, ok, server } from '@/test/server';
import { ApiError, api, apiBlob, apiPage, apiUrl, authEvents, setCsrfToken } from './api';

describe('api client', () => {
  it('returns the data field and sends no CSRF header on GET', async () => {
    let csrf: string | null = 'unset';
    server.use(
      http.get(
        '/api/v1/thing',
        ({ request }) => ((csrf = request.headers.get('x-csrf-token')), ok({ a: 1 })),
      ),
    );
    setCsrfToken('abc');
    expect(await api<{ a: number }>('/thing')).toEqual({ a: 1 });
    expect(csrf).toBeNull();
  });

  it('sends the CSRF token and JSON on unsafe methods', async () => {
    const seen: Array<{ csrf: string | null; type: string | null; body: unknown }> = [];
    server.use(
      http.post(
        '/api/v1/things',
        async ({ request }) => (
          seen.push({
            csrf: request.headers.get('x-csrf-token'),
            type: request.headers.get('content-type'),
            body: await request.json(),
          }),
          ok({})
        ),
      ),
    );
    setCsrfToken('tok-1');
    await api('/things', { method: 'POST', body: { name: 'x' } });
    expect(seen).toEqual([{ csrf: 'tok-1', type: 'application/json', body: { name: 'x' } }]);
    setCsrfToken(null);
    await api('/things', { method: 'POST', body: {} });
    expect(seen[1]!.csrf).toBeNull();
  });

  it('builds the query string, skipping empty values', async () => {
    let url = '';
    server.use(
      http.get('/api/v1/q', ({ request }) => ((url = new URL(request.url).search), ok([]))),
    );
    await api('/q', { query: { a: 1, b: '', c: undefined, d: null, e: false, f: 'x y' } });
    expect(url).toBe('?a=1&e=false&f=x+y');
    expect(apiUrl('/links', { limit: 5, q: undefined })).toBe('/api/v1/links?limit=5');
  });

  it('maps the error envelope to ApiError with code, message, request id and field details', async () => {
    server.use(
      http.post('/api/v1/bad', () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'slug', message: 'Too short' },
        ]),
      ),
    );
    const err = (await api('/bad', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'req_test',
    });
    expect(err.field('slug')).toBe('Too short');
    expect(err.field('other')).toBeUndefined();
  });

  it('survives a non-JSON error body (e.g. a proxy error page)', async () => {
    server.use(
      http.get(
        '/api/v1/proxy',
        () => new HttpResponse('<html>Bad gateway</html>', { status: 502 }),
      ),
    );
    const err = await api('/proxy').catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_ERROR', message: 'Request failed (502)' });
  });

  it('turns a network failure into a friendly ApiError', async () => {
    server.use(http.get('/api/v1/down', () => HttpResponse.error()));
    expect(await api('/down').catch((e) => e)).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('announces a 401 on protected calls, but not on public ones (login)', async () => {
    server.use(
      http.get('/api/v1/private', () =>
        apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      ),
      http.post('/api/v1/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      ),
    );
    const fired = vi.fn();
    authEvents.addEventListener('unauthorized', fired);
    await api('/private').catch(() => undefined);
    expect(fired).toHaveBeenCalledTimes(1);
    await api('/auth/login', { method: 'POST', body: {}, public: true }).catch(() => undefined);
    expect(fired).toHaveBeenCalledTimes(1);
    authEvents.removeEventListener('unauthorized', fired);
  });

  it('apiPage returns items and nextCursor (null when absent)', async () => {
    server.use(
      http.get('/api/v1/p1', () => ok([1, 2], { nextCursor: 'abc' })),
      http.get('/api/v1/p2', () => ok([3])),
    );
    expect(await apiPage('/p1')).toEqual({ data: [1, 2], nextCursor: 'abc' });
    expect(await apiPage('/p2')).toEqual({ data: [3], nextCursor: null });
  });

  it('uploads raw bodies with their content type and reads blobs', async () => {
    let type: string | null = null;
    server.use(
      http.post(
        '/api/v1/upload',
        ({ request }) => ((type = request.headers.get('content-type')), ok({})),
      ),
      http.post(
        '/api/v1/img',
        () =>
          new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
      ),
    );
    await api('/upload', {
      method: 'POST',
      raw: { data: new Blob(['x']), contentType: 'image/png' },
    });
    expect(type).toBe('image/png');
    expect((await apiBlob('/img', { method: 'POST', body: {} })).size).toBe(3);
  });
});
