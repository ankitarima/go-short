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

Redis fixed-window counters; credential endpoints are limited to 10 attempts / 15 min / IP. The limiter **fails open** if Redis is down (logged).

## Trusted proxies

Express `trust proxy` is set from `TRUST_PROXY` (hop count or CIDR list, e.g. `1` behind Caddy). `true` is rejected at startup because it would let any client spoof `X-Forwarded-For` and bypass IP rate limits. Use the exact number of proxies between the internet and the app.

## Logging

Request logs contain method, path (no query string), status, duration, request id, user id and workspace id. Cookies and authorization headers are redacted; passwords/tokens are never logged. In production the console email provider does not log message bodies.

## Privacy

Operators are responsible for compliance with applicable privacy laws; see [analytics.md](analytics.md).
