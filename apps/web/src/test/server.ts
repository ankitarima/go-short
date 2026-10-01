import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { WS_ID, analytics, makeCampaign, makeDomain, makeLink, makeMe, overview } from './fixtures';

const ok = (data: unknown, extra: object = {}) =>
  HttpResponse.json({ success: true, data, ...extra });
export const apiError = (
  status: number,
  code: string,
  message: string,
  details: Array<{ path: string; message: string }> = [],
) =>
  HttpResponse.json(
    {
      success: false,
      error: { code, message, ...(details.length ? { details } : {}) },
      requestId: 'req_test',
    },
    { status },
  );

/** Sensible defaults for a signed-in OWNER; individual tests override with `server.use(...)`. */
export const defaultHandlers = [
  http.get('/api/v1/me', () => ok(makeMe())),
  http.get(`/api/v1/workspaces/${WS_ID}/overview`, () => ok(overview)),
  http.get(`/api/v1/workspaces/${WS_ID}/analytics`, () => ok(analytics)),
  http.get(`/api/v1/workspaces/${WS_ID}/links`, () => ok([makeLink()], { nextCursor: null })),
  http.get(`/api/v1/workspaces/${WS_ID}/campaigns`, () =>
    ok([makeCampaign()], { nextCursor: null }),
  ),
  http.get(`/api/v1/workspaces/${WS_ID}/domains`, () => ok([makeDomain()])),
];

export const server = setupServer(...defaultHandlers);
export { http, HttpResponse, ok };
