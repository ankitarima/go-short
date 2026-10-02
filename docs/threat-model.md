# Threat model and security review

Scope: the whole application as built through phase 14 (API, redirect service, worker, web app, Postgres, Valkey). Deployment hardening (containers, TLS, backups) is phase 15 and is listed under "Not covered yet".

## Assets

1. **Account credentials and sessions** (passwords, session cookies, API keys, reset/invite tokens).
2. **Tenant data**: links, campaigns, QR codes, domains, analytics, audit logs. One workspace must never see another's.
3. **Visitor privacy**: no raw IPs stored; visitors are counted via day-salted hashes.
4. **Redirect integrity**: a short link must go where its owner said, and only there.
5. **Availability** of the redirect path (it is the product's hot path).
6. **Operator secrets**: `SESSION_SECRET` (also keys webhook-secret encryption and the analytics salts), database and Valkey credentials.

## Trust boundaries and actors

| Boundary                         | Who is on the other side                  | Main controls                                                                                   |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Internet to redirect service     | Anyone, including scanners and floods     | Strict slug/host validation, cache + single-flight, safe-Location check, no state-changing GETs |
| Internet to API / web            | Anonymous users, attackers, other tenants | Sessions + CSRF, role checks, tenant scoping, rate limits, body limits, CORS allow-list         |
| API to outbound webhook targets  | Tenant-controlled URLs                    | SSRF guard: resolve, vet every address, pin the connection, no redirects, timeout, size cap     |
| Uploaded files (QR logos)        | Tenant-controlled bytes                   | Re-encoded through pure-JS PNG/JPEG decoders, size and dimension caps, stored outside web root  |
| Operators' network to `/metrics` | Prometheus only                           | Separate port, loopback default, token required off-loopback in production                      |
| Browser to web app               | Third-party content, XSS attempts         | Strict CSP (`script-src 'self'`), no inline scripts, no tokens in localStorage                  |

## Threats and mitigations (STRIDE-style)

| Threat                                          | Mitigation                                                                                                                                       | Evidence                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Spoofing**: credential stuffing / brute force | Argon2id, per-IP (10/15 min) **and per-account** (30/15 min) limits, constant-time unknown-user path, metrics + alert                            | `hardening.test.ts`, alert `ApiLoginFailureSpike`        |
| Spoofing: forged client IP to dodge limits      | `trust proxy` must be an exact hop count/CIDR list; `true` refused                                                                               | `hardening.test.ts`, `config.test.ts`                    |
| Session theft / fixation                        | HttpOnly, SameSite=Lax, Secure in prod; new token on login; hashed at rest; revoked on password change/reset                                     | `auth.test.ts`                                           |
| **Tampering**: CSRF                             | Per-session CSRF token header on every cookie-authenticated unsafe request; bearer API keys have no ambient credentials                          | `auth.test.ts`, `apiKeys.test.ts`                        |
| Tampering: mass assignment                      | Zod schemas strip unknown fields; privileged fields come only from the server                                                                    | `hardening.test.ts`                                      |
| Tampering: poisoned redirect cache              | Every cached destination re-checked (`http(s)` only, no control chars); unknown statuses fall back to the default                                | `redirect.test.ts`                                       |
| **Repudiation**                                 | Audit log of security-relevant actions (who/what/when); request ids on every response and log line                                               | `workspaces.test.ts`                                     |
| **Information disclosure**: IDOR / tenant leak  | Workspace derived from membership, not from client claims; non-members get 404; all queries scoped                                               | role/IDOR matrix tests                                   |
| Disclosure: secrets in storage/logs             | Passwords/keys/tokens hashed; webhook secrets AES-256-GCM; log redaction; no query strings logged; exports exclude hashes                        | `security.test.ts`, `api.md`                             |
| Disclosure: cached authenticated responses      | `Cache-Control: no-store` on all `/api` responses (QR images `private, no-store`)                                                                | `metrics.test.ts`                                        |
| Disclosure: unauthenticated metrics             | Separate port, loopback default, bearer token required in production off-loopback                                                                | `metrics.test.ts` (shared), `config.test.ts`             |
| Disclosure: visitor identity                    | Raw IP never stored; day-salted hashes; retention setting                                                                                        | `analytics.md`                                           |
| **Denial of service**: redirect path            | Redis cache with jitter, negative cache for known hosts only, single-flight DB loads, request timeouts, Postgres fallback                        | `redirect.test.ts`                                       |
| DoS: CPU via password-link unlock               | Argon2 verification only after a per-IP-per-link limiter (10/15 min); the limiter **fails closed**                                               | `redirect.test.ts`                                       |
| DoS: unbounded memory / metric cardinality      | Bounded analytics buffer (oldest dropped, counted); route-pattern metric labels; dimension cardinality caps                                      | `bullPublisher` tests, `metrics.test.ts`                 |
| DoS: oversized input                            | 100 kB JSON limit, 2 kB form limit on the redirect service, logo size/dimension caps                                                             | `hardening.test.ts`                                      |
| **Elevation of privilege**                      | Role ceilings (nobody grants above their own), API keys capped at MEMBER and refused on account endpoints, admin via session only                | `workspaces.test.ts`, `apiKeys.test.ts`, `admin.test.ts` |
| SSRF through webhooks                           | See boundaries table; includes IPv4-mapped IPv6 and DNS-rebinding defences                                                                       | `security.test.ts`, `webhooks.test.ts`                   |
| Open redirect abuse (phishing via short links)  | Only `http(s)` destinations, no credentials in URL, loop guard; operators can disable links; no user-supplied redirect targets on the app itself | `links.test.ts`                                          |
| Stored/DOM XSS in the app                       | React escaping, no `dangerouslySetInnerHTML`, CSV formula neutralisation, SVG logo re-encoding, strict CSP                                       | browser CSP run (see below), `qr.test.ts`                |
| Supply chain                                    | Lockfile; permissive licences only; `npm audit` reviewed (below); no install-time network beyond npm                                             | audit table                                              |
| Misconfiguration in production                  | Startup refuses placeholder/low-variety `SESSION_SECRET`, `TRUST_PROXY=true`, missing `INTERNAL_API_TOKEN`, unauthenticated non-loopback metrics | `config.test.ts`                                         |

## Phase 14 review log

What was examined, and what changed as a result.

### Findings fixed

| #   | Finding                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The `.env.example` `SESSION_SECRET` placeholder passes the length check, so it could run in production, which also keys webhook-secret encryption and visitor-hash salts | Production now rejects placeholder-looking and low-variety secrets                                                                                                                                                                                               |
| F2  | Login was limited per IP only; guesses spread over many addresses against one account were bounded only by Argon2 cost                                                   | Added a per-account limiter (30 / 15 min, keyed by a hash of the email so Valkey never holds addresses). Trade-off: an attacker can make a victim's logins return 429 for a window, which is limited by the IP limiter and judged better than unbounded guessing |
| F3  | Authenticated JSON responses carried no `Cache-Control`, so a shared cache or the browser could store them                                                               | `Cache-Control: no-store` on everything under `/api`                                                                                                                                                                                                             |
| F4  | The SPA used an inline theme script, which forced `script-src 'unsafe-inline'`                                                                                           | Moved to `/theme-init.js`; production CSP is `script-src 'self'`. The production build was exercised in a real browser under that policy across every route: no violations                                                                                       |
| F5  | (Prevention) Adding metrics could have exposed internals on the public port or created unbounded series                                                                  | Separate non-public ports, loopback default, token enforced in production, route-pattern labels (tested)                                                                                                                                                         |
| F6  | The shipped dev Valkey ran `volatile-lru`; BullMQ warns that eviction can drop queue state                                                                               | Dev compose now uses `noeviction`; the production compose (phase 15) must too                                                                                                                                                                                    |

### Checked, no change needed

HTTP security headers on API and redirect responses (nosniff, no `X-Powered-By`, HSTS, frame protection, `Referrer-Policy`, CSP on redirect pages); CORS credentials only for allow-listed origins; JSON body limit and malformed-JSON handling; prototype-pollution-shaped bodies; mass assignment on register and workspace creation; documentation asset route (no path traversal, only whitelisted files); cookie flags; Host-header handling on the redirect service; secret scanning of the full git history and working tree with **gitleaks** (no findings); filesystem scan with **Trivy** (no secrets, no HIGH/CRITICAL misconfigurations).

### Dependency audit

`npm audit` and Trivy agree. Remaining HIGH advisories, all transitive dependencies of the **Prisma CLI** (`prisma`, a build/migration tool, not loaded by the running services):

| Advisory                                    | Package        | Why it is accepted                                                           |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| MySQL2 clear-password downgrade / zlib bomb | `mysql2`       | The MySQL driver is only used for MySQL datasources; goShort uses PostgreSQL |
| DeepmergeTS stack exhaustion                | `deepmerge-ts` | Used by Prisma CLI to merge its own config; no untrusted input reaches it    |
| esbuild dev-server file read (Windows only) | `esbuild`      | Dev tooling only; no esbuild server is exposed                               |

The fix offered by npm is a downgrade to Prisma 6, which is not appropriate. Revisit when Prisma ships a release that updates these. The production image (phase 15) should run migrations from a tooling stage so the CLI is not in the runtime image at all.

### Accepted risks and limits

- **Registration reveals whether an email exists** (`EMAIL_TAKEN`): a deliberate usability trade-off; the endpoint is rate limited.
- **Rate limiters fail open** when Valkey is down (an outage must not become an auth outage). The password-link unlock limiter **fails closed**.
- IP limits key on the full address, so an attacker with a whole IPv6 /64 can rotate addresses; the per-account login limiter and Argon2 cost bound this for logins.
- **No two-factor authentication**, no session idle timeout (30-day absolute expiry), email verification does not gate any feature.
- Custom domains are verified once, not re-verified; a later DNS change is not noticed (documented in [custom-domains.md](custom-domains.md)). Dangling-CNAME takeover of an operator's _customer_ domain is the customer's DNS responsibility.
- Up to roughly one flush interval of click events can be lost if the redirect process crashes with a non-empty buffer (analytics is secondary to redirects by design); sustained queue outages drop the oldest events once the bounded buffer fills, and this is counted and alerted on.
- Local file storage is the only storage provider shipped.
- The web CSP keeps `style-src 'unsafe-inline'` because the toast library injects a `<style>` element; scripts remain strictly `'self'`.

### Hardening added in phase 15

Runtime containers run non-root with a read-only root filesystem, all capabilities dropped and `no-new-privileges`; Postgres, Valkey and the metrics ports are on a private network with passwords/tokens; only the edge publishes ports; the Prisma CLI (and its advisories) is not in any runtime image; the edge never proxies `/metrics`, `/internal` or `/ready`, and serves the CSP from `apps/web/security-headers.ts`; on-demand certificates are issued only for hostnames the API approves. Verified by running the built stack (see [deployment.md](deployment.md)).

### Not covered yet

Certificate issuance against the real Let's Encrypt, a real Coolify deployment, host-level hardening (SSH, firewall, OS patching, which are the operator's job), encryption at rest of volumes, and an automated image/dependency/secret scan in CI plus browser E2E security checks (phase 16). Free tools suited to the CI step: Trivy (Apache-2.0), gitleaks (MIT), OSV-Scanner (Apache-2.0), OWASP ZAP (Apache-2.0).

## Reporting a vulnerability

Open a private security advisory on the project repository (or contact the maintainers directly) rather than a public issue.
