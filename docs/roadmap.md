# Roadmap and status

Single place to see what is done, what is partial and what is not started. **Update this file in the same commit that changes a status.** Statuses are verified against the repository, not aspirational.

_Last updated: 2026-10-01, at commit `f0c1448` (end of phase 5)._

Legend: ✅ done · 🟡 partial · ⬜ not started

## Phases

The spec's 30-step order (section 120) is grouped into phases. Phases 1-5 are complete.

| #   | Phase                                                                                                                             | Spec steps      | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- |
| 1   | Foundation: monorepo, TypeScript strict, config/shared/validation packages, Prisma schema + migrations, ESLint, foundational docs | 1-5             | ✅      |
| 2   | Auth, sessions, CSRF, rate limiting, workspaces, RBAC, invitations, audit log                                                     | 6-7             | ✅      |
| 3   | Domains (shared + custom, DNS verification, Caddy TLS check) and links (CRUD, slugs, UTM, expiry, passwords, cache invalidation)  | 8-9             | ✅      |
| 4   | Redis caching and the redirect service (hit/miss/fallback, link states, password unlock)                                          | 10-11           | ✅      |
| 5   | BullMQ publisher, analytics worker, raw events, daily rollups, GeoIP/UA/bot enrichment                                            | 12-15           | ✅      |
| 6   | Analytics query API: link/campaign/workspace summaries, timeline, breakdowns, filters, timezone, CSV export                       | 16              | ⬜ next |
| 7   | Campaigns: CRUD API, campaign analytics, link/QR association, UTM tracking                                                        | 19-20           | ⬜      |
| 8   | QR codes: local generation (SVG/PNG), customization, logo upload + `StorageProvider`, QR API                                      | 18              | ⬜      |
| 9   | API keys: create/revoke, hashed storage, flat `/api/v1/*` routes for key auth, per-key rate limits                                | 22              | ⬜      |
| 10  | Operations backend: cleanup jobs, retention enforcement, system-admin area, failed-job visibility, webhooks                       | (cross-cutting) | ⬜      |
| 11  | OpenAPI document + `/docs` UI, API documentation                                                                                  | 23              | ⬜      |
| 12  | Frontend foundation: Vite/React/Tailwind/shadcn setup, routing, auth screens, layout, dashboard                                   | 17              | ⬜      |
| 13  | Frontend features: links, campaigns, QR designer, domains wizard, analytics, team, API keys, settings, admin                      | 17, 21          | ⬜      |
| 14  | Security hardening review and Prometheus metrics + Grafana dashboards                                                             | 24-25           | ⬜      |
| 15  | Docker: production Dockerfiles, compose (dev/prod), Caddy, Coolify docs, backup/restore scripts                                   | 26              | ⬜      |
| 16  | CI (GitHub Actions), Husky/lint-staged, Playwright E2E                                                                            | 27              | ⬜      |
| 17  | k6 load tests (100k links), runs at 100/500/1000/2000 RPS, optimization from measurements                                         | 28-30           | ⬜      |
| 18  | Final docs (README, remaining docs), final report                                                                                 | (final)         | ⬜      |

The order of 12-13 (frontend) versus 7-11 (remaining backend) is flexible; the backend comes first because the UI needs those APIs.

## Test and quality status

| Check                                                                   | Status                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Typecheck (strict, all workspaces)                                      | ✅ clean                                                                                                  |
| ESLint (no `any`)                                                       | ✅ clean                                                                                                  |
| Production builds (api, redirect, worker)                               | ✅                                                                                                        |
| Tests                                                                   | ✅ 233 passing: api 100, redirect 45, worker 42, pipeline (tests/) 6, shared 26, validation 8, config 6   |
| Security tests (IDOR, role matrix, CSRF, rate limits, host abuse)       | ✅ for everything built so far                                                                            |
| Failure tests (Redis down, Postgres down, queue down, publisher throws) | ✅ for redirect, publisher and worker                                                                     |
| Mutation checks on critical protections                                 | ✅ done for tenant scoping, redirect safety, idempotency, uniques, caps                                   |
| E2E (Playwright)                                                        | ⬜ phase 16                                                                                               |
| Load tests (k6)                                                         | ⬜ phase 17. An `autocannon` baseline exists in [performance.md](performance.md) (laptop, not production) |
| CI                                                                      | ⬜ phase 16                                                                                               |

## Requirements by area

### Platform and multi-tenancy

| Requirement                                                                                 | Status | Notes                                                                                 |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| Monorepo (npm workspaces): api, redirect, worker, web; config, database, shared, validation | 🟡     | `apps/web` does not exist yet; a `tests/` workspace was added for cross-service tests |
| Workspaces, members, roles OWNER/ADMIN/MEMBER/VIEWER, explicit permissions                  | ✅     | `packages/shared/src/permissions.ts`                                                  |
| Tenant isolation (no client-supplied workspace trust, IDOR tests)                           | ✅     | for auth, workspaces, domains, links                                                  |
| Invitations                                                                                 | ✅     | email delivery is the console provider only                                           |
| Audit log (cursor-paginated)                                                                | ✅     | retention cleanup ⬜                                                                  |

### Auth and security

| Requirement                                                           | Status | Notes                                                                     |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Register, login, logout, sessions (DB-backed, hashed token, httpOnly) | ✅     |                                                                           |
| Argon2id, password reset, change password, email verification         | ✅     | verification does not gate anything                                       |
| CSRF, CORS, Helmet, body limits, standard error envelope, request ids | ✅     |                                                                           |
| Redis rate limiting (auth, link create, domain, invites)              | ✅     | fails open; redirect unlock fails closed                                  |
| Trusted proxy configuration                                           | ✅     | `TRUST_PROXY`, same semantics in api and redirect                         |
| Per-API-key rate limits                                               | ⬜     | phase 9                                                                   |
| System admin role/area                                                | 🟡     | `SystemRole` + `requireSystemAdmin` exist; no admin routes yet (phase 10) |
| Security hardening review                                             | ⬜     | phase 14                                                                  |

### Domains and links

| Requirement                                                                                                 | Status | Notes                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Shared default domain + custom domains                                                                      | ✅     |                                                                                                             |
| CNAME/TXT verification, one workspace per hostname                                                          | ✅     | no periodic re-verification (documented)                                                                    |
| Caddy on-demand TLS check endpoint                                                                          | ✅     | the Caddyfile itself is phase 15                                                                            |
| Stale unverified domain release                                                                             | 🟡     | `deleteStalePendingDomains` implemented and tested; not scheduled until the cleanup queue exists (phase 10) |
| Links: random/custom slugs, reserved words, UTM, expiry, password, enable/disable, per-link redirect status | ✅     |                                                                                                             |
| URL validation (http/https only, no credentials, loop guard)                                                | ✅     |                                                                                                             |
| Cursor pagination, filters, search                                                                          | ✅     |                                                                                                             |

### Redirect

| Requirement                                                                             | Status | Notes    |
| --------------------------------------------------------------------------------------- | ------ | -------- |
| Redis hot path, Postgres fallback, negative cache, single-flight                        | ✅     |          |
| Cache invalidation on every mutation, double delete, domain-wide purge                  | ✅     |          |
| Disabled/expired/not-found pages, optional fallback redirect                            | ✅     |          |
| Password-protected links (Argon2, limiter, 303)                                         | ✅     |          |
| Works when Redis or Postgres (cached) is down; analytics failure never breaks redirects | ✅     |          |
| Prometheus metrics for redirects                                                        | ⬜     | phase 14 |

### Analytics

| Requirement                                                                               | Status | Notes                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Async pipeline: batching publisher, BullMQ, worker                                        | ✅     |                                                                                                                 |
| UA parsing, bot detection (flagged, not dropped), offline GeoIP, referrer host, language  | ✅     |                                                                                                                 |
| Privacy: no raw IP, day-salted hashes, workspace IP-hash setting                          | ✅     |                                                                                                                 |
| Raw `ClickEvent`, daily rollups, dimension rollups, unique visitors                       | ✅     | uniques are approximate; range uniques = sum of daily                                                           |
| Retries, backoff, retained failed jobs (dead letter)                                      | ✅     | admin visibility of failed jobs ⬜ (phase 10)                                                                   |
| Analytics query API (summary, timeline, countries, devices, browsers, OS, referrers, UTM) | ⬜     | phase 6                                                                                                         |
| Filters (date, link, campaign, country, device), timezone handling                        | ⬜     | phase 6; rollups are UTC-day buckets                                                                            |
| CSV export (streaming)                                                                    | ⬜     | phase 6                                                                                                         |
| Retention enforcement (workspace setting exists)                                          | ⬜     | phase 10                                                                                                        |
| Daily/hourly aggregation jobs (`analytics-aggregation` queue)                             | ⬜     | rollups are currently written inline by the worker; a separate queue is only needed if load tests show a reason |

### Campaigns and QR

| Requirement                                                                                                  | Status | Notes                    |
| ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| Campaign table, links may reference a campaign (validated per workspace), campaign id carried into analytics | 🟡     | schema + validation only |
| Campaign CRUD API, campaign analytics, UTM breakdowns                                                        | ⬜     | phase 7                  |
| QR generation (SVG/PNG), customization, high error correction with logo, validation, SVG-injection safety    | ⬜     | phase 8                  |
| `QRCode` model                                                                                               | 🟡     | schema only              |
| `StorageProvider` + `LocalStorageProvider`, logo upload hardening                                            | ⬜     | phase 8                  |

### API surface

| Requirement                                                       | Status | Notes                                                                                                    |
| ----------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Versioned `/api/v1`, cursor pagination (max 100), standard errors | ✅     | routes are nested under `/workspaces/:id/...`; flat routes arrive with API keys                          |
| API keys (hashed, shown once, revoke, expiry, last used)          | ⬜     | phase 9; table exists                                                                                    |
| OpenAPI document, `/openapi.json`, `/docs`                        | ⬜     | phase 11                                                                                                 |
| Webhooks (HMAC signatures, retries)                               | ⬜     | phase 10; table exists                                                                                   |
| Feature flags                                                     | 🟡     | custom domains, campaigns (on links) and password links are enforced; QR logos and API flags are not yet |

### Operations and deployment

| Requirement                                                                                      | Status | Notes                                                |
| ------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------- |
| Dev infrastructure (Postgres 17, Valkey 8) via Docker Compose                                    | ✅     | `docker-compose.dev.yml` runs infra only             |
| Production Dockerfiles, `docker-compose.yml` / `.prod.yml`, Caddy, healthchecks, resource limits | ⬜     | phase 15                                             |
| Coolify documentation                                                                            | ⬜     | phase 15                                             |
| Backup/restore scripts and docs                                                                  | ⬜     | phase 15                                             |
| Health and readiness endpoints                                                                   | ✅     | api and redirect; worker has none yet                |
| Cleanup jobs (sessions, old events, expired links, temp files, failed jobs, audit logs)          | ⬜     | phase 10                                             |
| Prometheus metrics, Grafana dashboards                                                           | ⬜     | phase 14                                             |
| CI, Husky/lint-staged                                                                            | ⬜     | phase 16                                             |
| GeoIP database download script                                                                   | ✅     | `scripts/download-geoip.sh` (not bundled; CC BY 4.0) |

### Frontend (`apps/web`)

Everything is ⬜ (phases 12-13): login/register, dashboard, links, campaigns, QR designer, domains wizard, analytics, team, API keys, settings, admin, dark mode, empty/loading/error states.

### Documentation

| Document                                                                                  | Status                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| architecture, database, redirect-system, analytics, security, custom-domains, performance | ✅ written (keep in sync as features land)                                              |
| roadmap (this file)                                                                       | ✅                                                                                      |
| qr, campaigns, api, deployment, backup-restore                                            | ⬜                                                                                      |
| README (features, local dev, env vars, Docker, Coolify, monitoring, troubleshooting)      | ⬜                                                                                      |
| `LICENSE`, `THIRD_PARTY_LICENSES.md`                                                      | ✅ (copyright holder in `LICENSE` should be confirmed)                                  |
| `docs/database.md`                                                                        | 🟡 needs a refresh for the shared-domain change and the analytics tables as implemented |

## Decisions and deviations from the original spec

| Decision                                                               | Reason                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| npm instead of pnpm                                                    | Requested by the project owner                                                                                   |
| Valkey instead of Redis                                                | Redis 7.4+ is source-available (RSALv2/SSPL); Valkey is BSD-3 and protocol-compatible. Tested with BullMQ        |
| Routes nested under `/workspaces/:id/...`                              | Tenant derivation from the URL plus membership; flat routes come with API keys                                   |
| Redirect service uses raw `node:http`, not Express                     | Nothing on the hot path needs a framework                                                                        |
| Click events are published to BullMQ in batches, not one job per click | About 100x fewer Redis operations at burst rates; trade-off is losing at most one flush interval on a hard crash |
| `ua-parser-js` not used                                                | v2 is AGPL; `bowser` (MIT) used                                                                                  |
| Platform-shared default domain modelled as `Domain.workspaceId = null` | Lets every workspace use the default domain while keeping `(domainId, slug)` uniqueness                          |

## Known limitations and open items

- Unique visitors over a date range are the sum of daily uniques (the hash salt rotates daily by design).
- Daily campaign attribution follows the link's current campaign; raw events keep the click-time campaign.
- Unverified-domain squatting is only mitigated once the cleanup job is scheduled (phase 10).
- Email delivery is console-only; reset and invitation links are not delivered in production until an `EmailProvider` adapter exists.
- Two test anomalies were seen once each and never reproduced in about 70 further runs: one pipeline test failure and one 10-minute hang of a redirect test. Cause unknown; revisit if either recurs.
- The 2,000 RPS burst requirement is not yet verified on production-like hardware (phase 17).
