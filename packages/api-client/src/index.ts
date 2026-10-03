const BASE = '/api/v1';

export interface FieldIssue {
  path: string;
  message: string;
}

/** Normalised API error (the server's `{ success: false, error, requestId }` envelope). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details: FieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Message for one form field, if the server reported one. */
  field(name: string): string | undefined {
    return this.details.find((d) => d.path === name)?.message;
  }
}

/** Fired on any 401 from a protected call so the app can drop to the login screen. */
export const authEvents = new EventTarget();

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Scalar = string | number | boolean | null | undefined;
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, Scalar>;
  body?: unknown;
  /** Raw body (e.g. an image upload) with its content type. */
  raw?: { data: Blob | ArrayBuffer; contentType: string };
  signal?: AbortSignal;
  /** Do not treat a 401 as "session expired" (login/register endpoints). */
  public?: boolean;
}

function queryString(q?: RequestOptions['query']): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function send(path: string, o: RequestOptions): Promise<Response> {
  const method = o.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (o.raw) {
    headers['Content-Type'] = o.raw.contentType;
    body = o.raw.data as BodyInit;
  } else if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  // Cookie sessions need the CSRF token on every unsafe request.
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${queryString(o.query)}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: o.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  if (res.ok) return res;

  let code = 'HTTP_ERROR';
  let message = `Request failed (${res.status})`;
  let requestId: string | undefined;
  let details: FieldIssue[] = [];
  try {
    const j = (await res.json()) as {
      error?: { code?: string; message?: string; details?: FieldIssue[] };
      requestId?: string;
    };
    code = j.error?.code ?? code;
    message = j.error?.message ?? message;
    details = Array.isArray(j.error?.details) ? j.error.details : [];
    requestId = j.requestId;
  } catch {
    /* non-JSON error (proxy page): keep the generic message */
  }
  if (res.status === 401 && !o.public) authEvents.dispatchEvent(new Event('unauthorized'));
  throw new ApiError(res.status, code, message, requestId, details);
}

/** Returns the `data` field of a successful `{ success, data }` response. */
export async function api<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const res = await send(path, o);
  return ((await res.json()) as { data: T }).data;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  /** Present only where the API can count cheaply (some admin lists). */
  total?: number;
}
export async function apiPage<T>(path: string, o: RequestOptions = {}): Promise<Page<T>> {
  const res = await send(path, o);
  const j = (await res.json()) as { data: T[]; nextCursor?: string | null; total?: number };
  return {
    data: j.data,
    nextCursor: j.nextCursor ?? null,
    ...(typeof j.total === 'number' ? { total: j.total } : {}),
  };
}

export async function apiBlob(path: string, o: RequestOptions = {}): Promise<Blob> {
  return (await send(path, o)).blob();
}

/** URL for a GET endpoint that the browser can open directly (CSV export; the session cookie authenticates it). */
export const apiUrl = (path: string, query?: RequestOptions['query']): string =>
  `${BASE}${path}${queryString(query)}`;
