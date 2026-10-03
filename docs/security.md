# Security

## Authentication

- Passwords: Argon2id, 12–256 chars. Unknown-email logins burn an equivalent hash verification to limit timing differences.
- Sessions: random 256-bit token in an `httpOnly`, `SameSite=Lax` (`Secure` in production) cookie; Postgres stores only its SHA-256. 30-day expiry; logout, password change (other devices) and password reset (all devices) revoke sessions. Nothing is kept in localStorage.
- CSRF: each session has a CSRF token returned by login/register/`GET /me`; every unsafe request authenticated by cookie must send it as `X-CSRF-Token`. CORS only allows `CORS_ORIGINS`.
- Reset/verification/invitation tokens: random, single-use, stored hashed, expiring (reset 1h, verify 48h, invite 7d). Forgot-password always returns 200.
- Register returns `EMAIL_TAKEN` for existing emails (a deliberate usability tradeoff; the endpoint is rate limited).

## Authorization / tenant isolation

Routes live under `/api/v1/workspaces/:workspaceId/...`. `requireWorkspace(permission)` ignores any client claim and loads the caller's membership: non-member → 404 (existence not leaked), missing permission → 403. All queries are scoped by the verified workspace id. Role rules live in `packages/shared/src/permissions.ts`:

| Role   | Can                                                          |
| ------ | ------------------------------------------------------------ |
| VIEWER | read links, campaigns, QR, analytics, members                |
| MEMBER | + create/edit/delete links, campaigns, QR                    |
| ADMIN  | + workspace settings, members, domains, API keys, audit logs |
| OWNER  | + delete workspace, grant OWNER                              |

Nobody can grant a role above their own, and a workspace always keeps at least one OWNER. The IDOR and role matrix are covered by `apps/api/test/workspaces.test.ts`.

## Rate limiting

Redis fixed-window counters; credential endpoints are limited to 10 attempts / 15 min / IP, and logins additionally to 30 / 15 min **per account** (keyed by a hash of the email), so guesses spread across many IPs against one account are still capped. The limiters **fail open** if Redis is down (logged); the password-link unlock limiter fails closed. Rejections are counted in `goshort_rate_limited_total`.

## Trusted proxies

Express `trust proxy` is set from `TRUST_PROXY` (hop count or CIDR list, e.g. `1` behind Caddy). `true` is rejected at startup because it would let any client spoof `X-Forwarded-For` and bypass IP rate limits. Use the exact number of proxies between the internet and the app.

## Response headers and caching

- API: Helmet defaults (CSP `default-src 'self'`, HSTS, `nosniff`, frame protection, `Referrer-Policy: no-referrer`), `X-Powered-By` removed, and `Cache-Control: no-store` on every `/api` response.
- Redirect pages: `no-store`, `nosniff`, `default-src 'none'` CSP, `frame-ancestors 'none'`.
- Web app: the policy in [apps/web/security-headers.ts](../apps/web/security-headers.ts) (`script-src 'self'`, no inline script, `frame-ancestors 'none'`, `object-src 'none'`, same-origin connections) must be sent by whatever serves the SPA (Caddy, phase 15). `npm run preview --workspace @go-short/web` serves the production build with exactly these headers for checking.

## Production configuration checks

Startup fails in production for: a placeholder or low-variety `SESSION_SECRET` (generate one with `openssl rand -hex 32`), `TRUST_PROXY=true`, a missing `INTERNAL_API_TOKEN` with custom domains on, and metrics listening beyond loopback without `METRICS_TOKEN`. See [monitoring.md](monitoring.md) for the metrics endpoint design.

## Threat model

See [threat-model.md](threat-model.md) for assets, trust boundaries, mitigations with test references, the phase 14 review log, accepted risks and what is not covered yet.

## Logging

Request logs contain method, path (no query string), status, duration, request id, user id and workspace id. Cookies and authorization headers are redacted; passwords/tokens are never logged. In production the console email provider does not log message bodies.

## Privacy

Operators are responsible for compliance with applicable privacy laws; see [analytics.md](analytics.md).

## API keys

- **Format and storage:** `gs_<8-char prefix>_<43-char secret>` (256 bits of randomness). Only the SHA-256 hash and the public prefix are stored; the full key is returned **once**, at creation, with `Cache-Control: no-store`. Lists show only `gs_xxxxxxxx…`. Audit entries contain the prefix, never the key.
- **Scope:** a key is bound to **one workspace** and one role, **VIEWER** (read-only) or **MEMBER** (read/write). It can never be ADMIN/OWNER and never carries system-admin powers. A request naming a different workspace is `404`.
- **What keys cannot do:** keys are refused on endpoints that act on the person: `/me`, listing/creating workspaces, accepting invitations, logout, password change, leaving a workspace, audit logs, and **creating/listing/revoking API keys**. Members and domains management also needs ADMIN, which a key never has.
- **Lifecycle:** revocable (`revokedAt`), optional `expiresAt`, `lastUsedAt` (updated at most once a minute, off the request path), at most 50 active keys per workspace, creation rate limited. Removing a member **revokes their keys**; demoting them to VIEWER **caps their keys to VIEWER**; deleting the workspace deletes its keys.
- **Authentication:** `Authorization: Bearer gs_...`. A malformed/unknown/revoked/expired key is `401`. When an `Authorization` header is present it is used **instead of** any session cookie and never falls back to it. Shape is checked before any database lookup.
- **CSRF:** not applicable to bearer keys (no ambient credentials); cookie sessions still require the CSRF header.
- **Rate limit:** per key, fixed window, `API_KEY_RATE_LIMIT_PER_MINUTE` (default 600), with `RateLimit-*` and `Retry-After` headers. It fails open if Redis is unavailable (logged).
- **Flat routes:** `/api/v1/links`, `/domains`, `/campaigns`, `/qr`, `/analytics` use the key's own workspace; they require a key (a browser session gets `401` there). The same routers and permission checks serve the nested `/workspaces/:id/...` routes.
- `FEATURE_API=false` disables key authentication and creation.

## Analytics export

Raw-event CSV exports exclude IP and visitor hashes, neutralize spreadsheet formulas, and need MEMBER or above.

## Platform console

Platform staff (`MANAGER`, `ADMIN`, `SUPER_ADMIN`) use the console at `/console` (see [console.md](console.md)). It has its own sign-in and session (`gs_console` cookie, 8 hours, `SameSite=Strict`, sent only to `/api/v1/admin`), separate from the app's; neither session opens the other. The API checks the role on every request, only for browser sessions; API keys can never reach it. Suspending an account deletes its sessions and disables its API keys at once. Staff changes and suspensions are written to the audit log, the platform always keeps one active super admin, and metrics are read through a fixed list of server-defined queries (the browser can never send PromQL).
