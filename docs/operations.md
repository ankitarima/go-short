# Operations: cleanup, retention, admin, webhooks

## Scheduled cleanup (worker)

The worker registers one repeatable job per task on the `cleanup` queue at start-up (idempotent, UTC cron). Set `CLEANUP_ENABLED=false` to turn all of them off. Tasks run one at a time, in batches (no long locks), and log what they removed.

| Task                   | Schedule (UTC) | What it does                                                                                                                                                                                              |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`             | hourly         | Expired sessions; reset/verify tokens used or expired > 7 days ago; invitations expired/accepted > 30 days ago                                                                                            |
| `stale-domains`        | 03:10          | Releases never-verified domain claims older than 7 days (anti-squatting). Verified domains and the shared domain are never touched                                                                        |
| `click-retention`      | 03:30          | Deletes raw `ClickEvent` rows older than each workspace's `retentionDays`. Workspaces without a setting keep everything. Aggregated rollups (no personal data) are kept                                   |
| `visitors-and-buckets` | 03:50          | `DailyVisitor` dedupe rows older than 3 days; 15-minute buckets older than `BUCKET_RETENTION_DAYS` (default 400)                                                                                          |
| `audit-logs`           | 04:10          | Only if `AUDIT_LOG_RETENTION_DAYS` is set; otherwise audit logs are kept forever                                                                                                                          |
| `expired-links`        | 04:30          | Only if `EXPIRED_LINK_DELETE_AFTER_DAYS` is set: deletes links expired longer ago than that (and purges their cached redirects). Off by default: expired links keep their analytics and can be re-enabled |
| `orphan-logos`         | 04:50          | QR logo files older than a day that no QR code references (abandoned uploads)                                                                                                                             |
| `failed-jobs`          | 05:10          | Trims failed jobs older than 14 days from the analytics and webhook queues                                                                                                                                |

Nothing is deleted unless you configure it: the only unconditional deletions are expired sessions/tokens, stale unverified domain claims, dedupe bookkeeping and orphaned uploads. Retention defaults to **unlimited**.

## Privacy / retention settings

Per workspace (`PATCH /workspaces/:id`): `hashIps` (store a day-salted IP hash; default on), `filterBots` (hide bot traffic in analytics by default; bots are always stored), `retentionDays` (raw event retention; `null` = unlimited). The operator is responsible for compliance with the privacy laws that apply to them; this software does not make a deployment compliant on its own.

## Platform staff and the console

Platform staff run the whole installation from the **console** (`/console`, see [console.md](console.md)). Platform roles are separate from workspace roles (`User.systemRole`):

| Role          | Can                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `MANAGER`     | Read everything (users, workspaces, teams, usage, audit log, queues, monitoring); change nothing |
| `ADMIN`       | Also suspend/re-enable accounts, retry or delete failed jobs, run cleanup tasks                  |
| `SUPER_ADMIN` | Also add, change and remove platform staff                                                       |

There is deliberately no sign-up or environment-variable shortcut: the **first** super admin needs shell access. After that, super admins manage staff in the console.

```bash
npx tsx --env-file=.env scripts/grant-admin.ts you@example.com                  # SUPER_ADMIN
npx tsx --env-file=.env scripts/grant-admin.ts you@example.com --role MANAGER   # or ADMIN
npx tsx --env-file=.env scripts/grant-admin.ts you@example.com --revoke
```

`/api/v1/admin/*` is the console's API (session only, CSRF-protected; API keys are refused even for staff's keys): `GET /me`, `/stats`, `/usage`, `/users`, `/users/:id`, `/workspaces`, `/workspaces/:id`, `/teams`, `/domains`, `/links`, `/audit-logs`, `/staff`, `/queues`, `/queues/:queue/failed`, `/monitoring`, `/monitoring/range`; `POST /users/:id/disable|enable`; `POST|PATCH|DELETE /staff`; `POST /queues/:queue/failed/:jobId/retry`, `DELETE /queues/:queue/failed/:jobId`; `POST /cleanup/:task/run`. Staff cannot change their own role or suspend themselves, and the platform always keeps at least one active super admin. Responses use explicit field lists: password hashes, tokens, API key hashes and webhook secrets are never exposed, and analytics job payloads (which contain raw IPs) are shown only as a summary (`batchId`, event count). Every change is written to the audit log.

### Failed jobs (dead letter)

Jobs that exhaust their retries stay in the queue's _failed_ set for 14 days (up to 10,000), where the admin API shows reason and attempt count and can retry or delete them. Analytics: 5 attempts (2 s exponential backoff). Webhooks: 6 attempts (5 s exponential backoff). Retries are never unbounded.

## Webhooks

Subscribe a workspace to `link.created`, `link.updated`, `link.deleted`, `campaign.created`, `domain.verified` (`analytics.threshold` is reserved for later). Manage them in `/api/v1/workspaces/:id/webhooks` (OWNER/ADMIN, signed-in sessions only): create (returns the signing secret **once**), list, patch, delete, `POST /:id/rotate-secret`, `POST /:id/test`. At most 10 per workspace.

**Delivery:** `POST` with a JSON body `{ id, type, createdAt, workspaceId, data }` and headers `X-GoShort-Event`, `X-GoShort-Delivery`, `X-GoShort-Signature: t=<unix seconds>,v1=<hex>`. The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`. **Receivers must** recompute it over the raw body, compare in constant time, and reject timestamps older than ~5 minutes (replay protection). Respond `2xx` quickly; anything else (including redirects, which are never followed) is retried with exponential backoff (5 s, 10 s, 20 s, 40 s, 80 s), then kept as a failed job.

```js
const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
const ok =
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) &&
  Math.abs(Date.now() / 1000 - t) < 300;
```

**Secrets** are stored encrypted (AES-256-GCM under a key derived from `SESSION_SECRET`) and can only be rotated, not read back. **Changing `SESSION_SECRET` makes stored webhook secrets undecryptable**; rotate each webhook's secret afterwards.

**Emission is best-effort:** it happens after the change is committed and never fails the request; if the queue is down the event is not delivered (it is logged). Webhook payloads contain no password hashes or domain verification tokens.

### SSRF protection

Delivery is the only place the platform calls a URL on a user's behalf, so it is hardened: URLs must be `https` (static checks at creation: no credentials, no localhost/internal names, no private IP literals); at delivery the hostname is resolved **in the worker**, **every** returned address must be public (loopback, RFC1918, link-local/cloud metadata, CGNAT, multicast, unique-local, IPv4-mapped IPv6 etc. are refused), and the connection is **pinned to the vetted address** (no second DNS lookup, so DNS rebinding cannot swap in a private IP) while TLS is still verified against the original hostname. Redirects are not followed, requests time out after 10 s, and response bodies are read only up to 64 KB. `WEBHOOK_ALLOW_INSECURE=true` disables all of this for local development; never enable it in production (the worker logs a warning).
