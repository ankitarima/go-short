# Roadmap and status

Single place to see what is done, what is partial and what is not started. **Update this file in the same commit that changes a status.** Statuses are verified against the repository, not aspirational.

_Last updated: 2026-10-01, at the end of phase 15. Everything is built and packaged for deployment; the Coolify deployment, CI/E2E, load tests and the final README remain._

Legend: ✅ done · 🟡 partial · ⬜ not started

## Phases

The spec's 30-step order (section 120) is grouped into phases. **Phases 1-15 are complete.**

| #   | Phase                                                                                                                             | Spec steps      | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| 1   | Foundation: monorepo, TypeScript strict, config/shared/validation packages, Prisma schema + migrations, ESLint, foundational docs | 1-5             | ✅     |
| 2   | Auth, sessions, CSRF, rate limiting, workspaces, RBAC, invitations, audit log                                                     | 6-7             | ✅     |
| 3   | Domains (shared + custom, DNS verification, Caddy TLS check) and links (CRUD, slugs, UTM, expiry, passwords, cache invalidation)  | 8-9             | ✅     |
| 4   | Redis caching and the redirect service (hit/miss/fallback, link states, password unlock)                                          | 10-11           | ✅     |
| 5   | BullMQ publisher, analytics worker, raw events, daily rollups, GeoIP/UA/bot enrichment                                            | 12-15           | ✅     |
| 6   | Analytics query API: summaries, timeline, breakdowns, filters, exact timezones, CSV export                                        | 16              | ✅     |
| 7   | Campaigns: CRUD API, campaign analytics, link/QR association, UTM defaults                                                        | 19-20           | ✅     |
| 8   | QR codes: local generation (SVG/PNG), customization, logo upload, `StorageProvider`, QR API, scan attribution                     | 18              | ✅     |
| 9   | API keys: hashed, role-scoped, revocable, per-key rate limits, flat `/api/v1/*` routes                                            | 22              | ✅     |
| 10  | Operations backend: cleanup/retention jobs, system-admin API, failed-job inspection, signed webhooks                              | (cross-cutting) | ✅     |
| 11  | OpenAPI 3.1 document, `/docs` UI, route-drift and response-conformance tests, API guide                                           | 23              | ✅     |
| 12  | Frontend foundation: Vite/React/Tailwind/shadcn setup, routing, auth screens, layout, dashboard                                   | 17              | ✅     |
| 13  | Frontend features: links, campaigns, QR designer, domains wizard, analytics, team, API keys, settings, admin                      | 17, 21          | ✅     |
| 14  | Security hardening review and Prometheus metrics + Grafana dashboards                                                             | 24-25           | ✅     |
| 15  | Docker: production Dockerfiles, compose (dev/prod), Caddy, Coolify docs, backup/restore scripts                                   | 26              | ✅     |
| 16  | Coolify deployment (first real deploy), CI (GitHub Actions), Husky, Playwright E2E                                                | 27              | ⬜     |
| 17  | k6 load tests (100k links), runs at 100/500/1000/2000 RPS, optimization from measurements                                         | 28-30           | ⬜     |
| 18  | Final docs (README, deployment, backup-restore, database refresh), final report                                                   | (final)         | ⬜     |

## Test and quality status

| Check                                                                          | Status                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Typecheck (strict, all workspaces)                                             | ✅ clean                                                                                                  |
| ESLint (no `any`)                                                              | ✅ clean                                                                                                  |
| Production builds (api, redirect, worker)                                      | ✅                                                                                                        |
| Tests                                                                          | ✅ 607 passing (api 272, web 96, shared 90, worker 79, redirect 48, validation 8, config 8, pipeline 6)   |
| Security tests (IDOR, role matrix, CSRF, rate limits, host abuse, SSRF, keys)  | ✅ for everything built so far, with mutation checks on the critical protections                          |
| Failure tests (Redis down, Postgres down, queue down, publisher/worker errors) | ✅                                                                                                        |
| API docs accuracy (valid OpenAPI, route drift, real-response conformance)      | ✅ enforced by tests                                                                                      |
| E2E (Playwright)                                                               | ⬜ phase 16 (needs the frontend)                                                                          |
| Load tests (k6)                                                                | ⬜ phase 17. An `autocannon` baseline exists in [performance.md](performance.md) (laptop, not production) |
| CI                                                                             | ⬜ phase 16                                                                                               |

## Requirements by area

### Platform and multi-tenancy

| Requirement                                                                                 | Status | Notes                                                                      |
| ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| Monorepo (npm workspaces): api, redirect, worker, web; config, database, shared, validation | ✅     | a `tests/` workspace holds cross-service tests                             |
| Workspaces, members, roles OWNER/ADMIN/MEMBER/VIEWER, explicit permissions                  | ✅     | `packages/shared/src/permissions.ts`                                       |
| Tenant isolation (no client-supplied workspace trust, IDOR tests)                           | ✅     | auth, workspaces, domains, links, campaigns, QR, analytics, keys, webhooks |
| Invitations                                                                                 | ✅     | email delivery is the console provider only                                |
| Audit log (cursor-paginated, retention optional)                                            | ✅     | never contains secrets; webhook entries record the host only               |

### Auth and security

| Requirement                                                                    | Status | Notes                                                                           |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| Register, login, logout, sessions (DB-backed, hashed token, httpOnly)          | ✅     |                                                                                 |
| Argon2id, password reset, change password, email verification                  | ✅     | verification does not gate anything                                             |
| CSRF, CORS, Helmet, body limits, standard error envelope, request ids          | ✅     |                                                                                 |
| Redis rate limiting (auth, creation, exports, keys, invites, uploads)          | ✅     | fails open; password-link unlock fails closed                                   |
| Trusted proxy configuration                                                    | ✅     | `TRUST_PROXY`, same semantics in api and redirect                               |
| API keys (hashed, shown once, role-scoped, revocable, per-key limits)          | ✅     | tied to membership: revoked on removal, capped on demotion                      |
| SSRF protection for outbound webhooks                                          | ✅     | resolve, vet every address, pin the connection; no redirects; timeout; size cap |
| System admin role/area                                                         | ✅     | session only; grant via `scripts/grant-admin.ts`                                |
| Security hardening review (headers audit, dependency audit, threat-model pass) | ✅     | [threat-model.md](threat-model.md): 6 findings fixed, accepted risks listed     |

### Domains and links

| Requirement                                                                                                 | Status | Notes                                    |
| ----------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| Shared default domain + custom domains                                                                      | ✅     |                                          |
| CNAME/TXT verification, one workspace per hostname                                                          | ✅     | no periodic re-verification (documented) |
| Caddy on-demand TLS check endpoint                                                                          | ✅     | the Caddyfile itself is phase 15         |
| Stale unverified domain release                                                                             | ✅     | scheduled daily by the cleanup queue     |
| Links: random/custom slugs, reserved words, UTM, expiry, password, enable/disable, per-link redirect status | ✅     |                                          |
| URL validation (http/https only, no credentials, loop guard)                                                | ✅     |                                          |

### Redirect

| Requirement                                                                            | Status | Notes                          |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| Redis hot path, Postgres fallback, negative cache, single-flight                       | ✅     |                                |
| Cache invalidation on every mutation, double delete, domain-wide purge                 | ✅     |                                |
| Disabled/expired/not-found pages, optional fallback redirect                           | ✅     |                                |
| Password-protected links (Argon2, limiter, 303)                                        | ✅     |                                |
| Works when Redis or Postgres (cached) is down; analytics failure never breaks redirect | ✅     |                                |
| Prometheus metrics for redirects                                                       | ✅     | [monitoring.md](monitoring.md) |

### Analytics

| Requirement                                                                            | Status | Notes                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Async pipeline: batching publisher, BullMQ, worker                                     | ✅     |                                                                                                                             |
| UA parsing, bot detection (flagged, not dropped), offline GeoIP, referrer host         | ✅     |                                                                                                                             |
| Privacy: no raw IP, day-salted hashes, workspace IP-hash setting                       | ✅     |                                                                                                                             |
| Raw `ClickEvent`, daily rollups, dimension rollups, 15-minute buckets, unique visitors | ✅     | uniques are approximate; range uniques = sum of daily                                                                       |
| Retries, backoff, retained failed jobs (dead letter), admin visibility                 | ✅     | `/api/v1/admin/queues/...`                                                                                                  |
| Analytics query API (summary, timeline, all breakdowns, UTM, QR scans)                 | ✅     |                                                                                                                             |
| Filters (date, link, campaign, country, device), exact timezone handling               | ✅     | country/device filters use the event table, limited to 31 days                                                              |
| CSV export (streamed, formula-safe, no IPs)                                            | ✅     |                                                                                                                             |
| Retention enforcement (per-workspace raw events)                                       | ✅     | unlimited by default                                                                                                        |
| Separate `analytics-aggregation` queue                                                 | 🟡     | rollups are written inline by the worker in one transaction; a separate queue is only warranted if load tests show a reason |

### Campaigns and QR

| Requirement                                                                            | Status | Notes                                                   |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| Campaign CRUD, counts, analytics, default `utm_campaign`                               | ✅     |                                                         |
| QR generation (SVG/PNG), customization, scannability rules, logo, SVG-injection safety | ✅     | tests decode the generated codes with a real QR reader  |
| QR scan attribution (`?qr=` marker validated per link)                                 | ✅     |                                                         |
| `StorageProvider` + `LocalStorageProvider`, logo upload hardening                      | ✅     | S3/MinIO/R2 adapters would implement the same interface |

### API surface

| Requirement                                                                                                            | Status | Notes                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Versioned `/api/v1`, cursor pagination (max 100), standard errors                                                      | ✅     | nested `/workspaces/:id/...` plus flat routes for API keys                                                         |
| OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/api-docs` (internal)                                                   | ✅     | bundled UI, no CDN; not proxied publicly                                                                           |
| Public documentation site (`/docs`): guides + generated API reference                                                  | ✅     | [frontend.md](frontend.md); search, dark mode, code samples; tests check content and links                         |
| Platform console (`/console`): users, workspaces, teams, staff and roles, usage, audit log, queues, Prometheus metrics | ✅     | [console.md](console.md); manager/admin/super-admin roles, account suspension, 20 UI tests, API tests              |
| Marketing site: mega menu, home, product pages (goLinks, goCampaigns, goAnalytics), solutions, security                | ✅     | [frontend.md](frontend.md); content-driven, tested, CSP-clean                                                      |
| Webhooks (HMAC signatures, retries, encrypted secrets)                                                                 | ✅     | `analytics.threshold` is reserved, not implemented                                                                 |
| Feature flags (custom domains, campaigns, QR logos, password links, API)                                               | ✅     | all five are enforced and tested                                                                                   |
| Email provider adapter beyond console logging (e.g. SMTP)                                                              | ⬜     | the `EmailProvider` interface exists; in production reset/invite links are not delivered until an adapter is added |

### Operations and deployment

| Requirement                                                                                      | Status | Notes                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| Dev infrastructure (Postgres 17, Valkey 8) via Docker Compose                                    | ✅     | `docker-compose.dev.yml` runs infra only                                                                    |
| Production Dockerfiles, `docker-compose.yml` / `.prod.yml`, Caddy, healthchecks, resource limits | ✅     | [deployment.md](deployment.md); limits are unmeasured starting points                                       |
| Coolify documentation                                                                            | 🟡     | [coolify.md](coolify.md) written and the compose variant run locally; first real Coolify deploy is phase 16 |
| Backup/restore scripts and docs                                                                  | ✅     | [backup-restore.md](backup-restore.md); restore tested end to end; `age` encryption path untested           |
| Health and readiness endpoints                                                                   | 🟡     | api and redirect have them; the worker has none yet                                                         |
| Cleanup jobs (sessions, retention, stale domains, expired links, orphan files, failed jobs)      | ✅     | [operations.md](operations.md)                                                                              |
| Prometheus metrics, Grafana dashboards, alert rules                                              | ✅     | [monitoring.md](monitoring.md) (dev stack; production wiring is phase 15)                                   |
| CI, Husky/lint-staged                                                                            | ⬜     | phase 16                                                                                                    |
| GeoIP database download script                                                                   | ✅     | `scripts/download-geoip.sh` (not bundled; CC BY 4.0)                                                        |

### Frontend (`apps/web`)

✅ (phases 12-13), see [frontend.md](frontend.md): login/register/reset/verify/invite, onboarding, dashboard, links, campaigns, QR designer with live preview, domains wizard, analytics (filters, timezone, CSV export), team, API keys, settings (general, privacy, security, webhooks, audit log), admin, dark mode, empty/loading/error states, responsive down to phone width. 96 Vitest tests (MSW, real route table). Browser E2E is phase 16.

### Documentation

| Document                                                                                                        | Status                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| architecture, redirect-system, analytics, security, custom-domains, performance, qr, campaigns, api, operations | ✅ written (keep in sync as features land)                                                          |
| roadmap (this file)                                                                                             | ✅                                                                                                  |
| `LICENSE`, `THIRD_PARTY_LICENSES.md`                                                                            | ✅ licenses verified from installed packages (confirm the copyright holder in `LICENSE`)            |
| `docs/database.md`                                                                                              | ✅ refreshed for the current schema                                                                 |
| deployment, backup-restore, coolify                                                                             | ✅ [deployment.md](deployment.md), [backup-restore.md](backup-restore.md), [coolify.md](coolify.md) |
| README (features, local dev, env vars, Docker, Coolify, monitoring, troubleshooting)                            | ⬜ phase 18                                                                                         |

## Decisions and deviations from the original spec

| Decision                                                                | Reason                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| npm instead of pnpm                                                     | Requested by the project owner                                                                                   |
| Valkey instead of Redis                                                 | Redis 7.4+ is source-available (RSALv2/SSPL); Valkey is BSD-3 and protocol-compatible. Tested with BullMQ        |
| Routes nested under `/workspaces/:id/...` plus flat routes for API keys | Tenant derived from the URL and membership for people; from the key for integrations                             |
| Redirect service uses raw `node:http`, not Express                      | Nothing on the hot path needs a framework                                                                        |
| Click events are published to BullMQ in batches, not one job per click  | About 100x fewer Redis operations at burst rates; trade-off is losing at most one flush interval on a hard crash |
| 15-minute click buckets in addition to daily rollups                    | Exact timelines in any timezone (including +5:30/+5:45) without scanning raw events                              |
| `ua-parser-js` not used                                                 | v2 is AGPL; `bowser` (MIT) used                                                                                  |
| Logo handling in pure JS (`pngjs`, `jpeg-js`), no `sharp`               | No native binaries or LGPL libvips; fine for small logos                                                         |
| Platform-shared default domain modelled as `Domain.workspaceId = null`  | Lets every workspace use the default domain while keeping `(domainId, slug)` uniqueness                          |
| Webhook secrets encrypted with a key derived from `SESSION_SECRET`      | They must be recoverable to sign; rotating `SESSION_SECRET` requires rotating webhook secrets                    |
| Response schemas in OpenAPI are hand-written                            | Verified against real responses by tests, which is stricter than generating them                                 |

## Known limitations and open items

- Unique visitors over a date range are the sum of daily uniques (the hash salt rotates daily by design).
- Daily campaign attribution follows the link's current campaign; raw events keep the click-time campaign.
- In a non-UTC timezone, unique visitors and breakdowns are aggregated by UTC day and can differ slightly from the exact timeline at the edges of the range (stated in `meta.notes`).
- Webhook emission is best-effort (never fails the originating request; lost if the queue is down at that moment).
- Email delivery is console-only; reset and invitation links are not delivered in production until an `EmailProvider` adapter exists.
- Intermittent test anomalies seen once each and **never reproduced** in many reruns: a pipeline test failure, a 10-minute hang of a redirect test, and two failures in `links.test.ts` (a 404 on link creation and a rate-limit assertion). The link tests now report full diagnostics if it recurs; cause unknown. Seen once more in `qr.test.ts` (a 404 on link creation, an `ECONNRESET`) during a full run that overlapped with stopping local dev servers; passed on immediate rerun. Once more in `webhooks.test.ts` (two tests) during a full run while the local dev worker was running against the same Valkey; 3 isolated reruns and a full rerun passed. A running dev stack sharing the test Redis/Postgres is the prime suspect; stop `npm run dev` before the full suite, and CI (phase 16) will use isolated services.
- The 2,000 RPS burst requirement is not yet verified on production-like hardware (phase 17).
