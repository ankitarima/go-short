# API

The interactive reference is served by the API itself: **`/docs`** (Swagger UI, bundled, no CDN) and the machine-readable **`/openapi.json`** (OpenAPI 3.1). In production route both through your reverse proxy to the API service. This page is the short guide; the reference lists every operation, schema, permission, status code and limit.

## How the document stays accurate

- **Request schemas are generated from the same Zod schemas that validate requests** (`packages/validation`), so limits shown in the docs are the limits enforced.
- **Response schemas are hand-written** in `apps/api/src/openapi/schemas.ts`, and `test/openapi.test.ts` validates **real responses** from ~60 endpoints against them (additional undocumented fields fail the test).
- A **route drift guard** walks the live Express router tree and fails the build if a route exists that is not documented, or a documented operation does not exist.
- The document itself is validated against the OpenAPI 3.1 schema.

When you add or change an endpoint: add it to `apps/api/src/openapi/operations.ts` (and any new DTO to `schemas.ts`); the tests tell you what you missed.

## Calling the API

**API key** (scripts, integrations): create one in the app (Settings → API keys; shown once), then

```bash
curl -H "Authorization: Bearer gs_AbCdEfGh_...43 chars..." https://app.example.com/api/v1/links?limit=20

curl -X POST https://app.example.com/api/v1/links \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"destinationUrl":"https://example.com/sale","slug":"summer-sale","utmSource":"newsletter"}'

curl -H "Authorization: Bearer $KEY" \
  "https://app.example.com/api/v1/analytics?from=2026-10-01&to=2026-10-31&timezone=Asia/Kolkata"

curl -X POST https://app.example.com/api/v1/qr -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Poster","linkId":"<link id>","format":"png","size":1024,"errorCorrection":"H"}'
```

Keys are bound to one workspace and are `VIEWER` (read-only) or `MEMBER` (read/write); they use the **flat routes** (`/api/v1/links`, `/domains`, `/campaigns`, `/qr`, `/analytics`) and the nested `/workspaces/{id}/...` routes for their own workspace. They cannot manage keys, members, domains or webhooks, or call user-level endpoints. See [security.md](security.md#api-keys).

**Session cookie** (the web app): `POST /api/v1/auth/login`, then send the returned `csrfToken` in `X-CSRF-Token` on every `POST`/`PATCH`/`DELETE`.

## Conventions

- **Success:** `{ "success": true, "data": ... }`. **Errors:** `{ "success": false, "error": { "code", "message", "details"? }, "requestId" }` (also the `X-Request-Id` header). Stack traces are never returned.
- **Status codes:** 400 validation, 401 unauthenticated, 403 forbidden/CSRF/disabled feature, 404 not found (also for resources in workspaces you do not belong to), 409 conflict, 413 too large, 415 unsupported media type, 429 rate limited (`Retry-After`), 5xx server.
- **Pagination:** cursor-based, `?limit=` (1-100, default 50) and `?cursor=`; follow `nextCursor` until `null`. Used by links, campaigns, QR codes, audit logs and the admin lists.
- **IDs** are opaque strings; do not parse them.
- **Dates** are ISO 8601 in UTC; analytics `from`/`to` are local `YYYY-MM-DD` dates in the requested `timezone`.

## Rate limits (summary)

Auth 10 attempts / 15 min / IP · API keys 600 / min / key (`API_KEY_RATE_LIMIT_PER_MINUTE`, with `RateLimit-*` headers) · links 120 / min and QR 60 / min per workspace · logo upload 30 / h · analytics export 5 / min · domain verification 10 / min · invitations 30 / h. Limits fail **open** if Redis is unavailable (logged), except password-protected link unlocking, which fails **closed**.

## Related

[analytics.md](analytics.md) (query parameters, accuracy) · [campaigns.md](campaigns.md) · [qr.md](qr.md) · [custom-domains.md](custom-domains.md) · [operations.md](operations.md) (admin, webhooks, cleanup) · [security.md](security.md)
