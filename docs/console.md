# Console

The console is the platform staff area: one place to see and manage the whole installation. It is a separate app (`apps/console`) that shares the design system (`packages/ui`) and API client (`packages/api-client`) with the web app, and is served at **`https://APP_DOMAIN/console`** on the same origin. It has **its own sign-in, separate from the app's** (see below). It is never indexed (`noindex` meta and `X-Robots-Tag`).

## Separate sign-in

The console and the app do not share a login session, even though staff use the same account (email and password):

- The console has its own sign-in endpoint (`POST /api/v1/admin/auth/login`), **staff accounts only**. It sets a `gs_console` cookie that is `HttpOnly`, `SameSite=Strict`, sent only to `/api/v1/admin`, and lasts **8 hours**. The app's `gs_session` cookie lasts 30 days.
- Signing in to the console does **not** sign you in to the app (the app asks you to sign in as usual), and an app session does **not** open the console. The app never accepts the console cookie, and the console never reads the app cookie or API keys.
- Signing out of one leaves the other untouched.
- Removing someone's platform role, or suspending the account, ends their console session immediately.
- The console sign-in has its own rate limits (per IP and per account). A customer account is told it has no console access only after the correct password, so it cannot be used to find out which emails exist.

Why: a console session is far more powerful than an app session, so it gets a shorter life, a stricter cookie and no way to be reached by anything the app does.

## Roles

Platform roles are separate from workspace roles and are checked by the API on every request; the UI only hides what the API would refuse.

| Role            | Can                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Manager**     | Read everything. Intended for monitoring and support.                                                              |
| **Admin**       | Everything a manager can, plus suspend and re-enable accounts, retry or delete failed jobs, and run cleanup tasks. |
| **Super admin** | Everything an admin can, plus add, change and remove platform staff, and manage the shared short domains.          |

Rules the API enforces: nobody changes their own role or suspends themselves; only a super admin can change or suspend another staff member; the platform always keeps at least one **active** super admin. API keys never carry platform powers.

## What is in it

| Page                | Purpose                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**        | Totals (users, workspaces, links, domains), clicks and sign-ups over 7/30/90 days, the busiest workspaces, pipeline status                                                               |
| **Monitoring**      | Live health from Prometheus (redirects/s, p95 latency, error ratios, cache hit ratio, queue depth, failed logins, services up), trend charts, and buttons to open Grafana and Prometheus |
| **Users**           | Search all accounts; open one to see its workspaces, sessions and API keys; suspend or re-enable it                                                                                      |
| **Workspaces**      | Every workspace with its size; a detail page with members, domains, privacy settings and 30-day clicks                                                                                   |
| **Teams**           | Every membership across all workspaces, filterable by role                                                                                                                               |
| **Short domains**   | The shared hostnames every workspace can put links on: add one, choose the default, disable, enable or remove it, and check its DNS. See below                                           |
| **Platform staff**  | Who has console access and with which role; super admins add, change and remove them                                                                                                     |
| **Audit log**       | Security-relevant actions across the platform, with who did them, including everything staff do in the console                                                                           |
| **Queues and jobs** | Queue counts, failed jobs (payloads summarised, never shown), retry/delete, and run-now cleanup tasks                                                                                    |

## Short domains

Shared short domains live in the database and are managed on the **Short domains** page (super admin to change; manager and admin can look). `DEFAULT_SHORT_DOMAIN` is only a **first-boot seed**: when the database has no shared domain yet, it creates that one as the default. After that the environment variable is never consulted for what is active, so a restart cannot undo a change made here, and you do not edit environment variables or redeploy to add a domain.

- **Add**: type a hostname (e.g. `go.example.com`). It is active at once and every workspace sees it in the link form. The first shared domain is always the default; tick "Make it the default" to move the default. After adding, the console checks whether the name already points at this server and says so if it does not (a hint: behind a CDN or proxy the addresses can legitimately differ).
- **Default**: used for new links when the person does not pick a domain, and as the CNAME target customers are told to use for their own domains. Changing it never touches existing links. A customer who pointed a CNAME at another active shared domain still verifies.
- **Disable / enable**: a disabled domain stops redirecting its links, is not offered for new ones and gets no certificate. The default cannot be disabled, and at least one shared domain must stay active.
- **Remove**: refused for the default and for any domain that still has links (removing would delete them and their QR codes); disable it instead.
- **Names that cannot be added**: the app's own hostname, IP addresses, anything that is not a valid hostname, and names already used (including a workspace's custom domain).

Every change is in the audit log (`SHARED_DOMAIN_ADDED`, `SHARED_DOMAIN_UPDATED`, `SHARED_DOMAIN_REMOVED`).

**Certificates and DNS are still outside the app.** Point the new hostname's DNS at the server first. With the standalone Caddy stack the certificate is then issued automatically on the first request (Caddy asks the API's TLS check, which now approves every active shared domain). On **Coolify** the proxy only serves hostnames it has been told about: add the new hostname to the `web` service's domains as well ([coolify.md](coolify.md)). Cached redirects for a domain that is disabled are cleared immediately; the redirect service looks up which hostnames are valid every 30 seconds, so the bare root of a just-added or just-disabled domain can lag by that long.

## Suspending an account

An admin can suspend an account from the user's detail. It takes effect immediately: every session is deleted, sign-in is refused (with a message only after the correct password, so it cannot be used to discover which emails are suspended), and the account's API keys stop working. Workspaces and data are untouched. Re-enabling restores access (the person signs in again; sessions are not resurrected).

## Getting access

1. Register a normal account in the app.
2. Make the first super admin from the server (there is no web shortcut by design):
   ```bash
   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com
   ```
   In the Docker deployment use the SQL in [deployment.md](deployment.md).
3. Open `/console`. From then on, add managers, admins and super admins under **Platform staff**.

Existing installs: the migration that introduced platform roles promoted every previous `ADMIN` to `SUPER_ADMIN`, because the old role could do everything, including granting itself to others.

## Monitoring setup

The API reads Prometheus through a **fixed list of named queries** (no PromQL from the browser), so staff get charts without a query console that could read or overload anything else. Configure:

| Variable                 | Meaning                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROMETHEUS_URL`         | Prometheus base URL the **API** can reach (for example `http://prometheus:9090` with the `monitoring` profile). Unset: the page explains how to connect it. |
| `CONSOLE_GRAFANA_URL`    | Link shown to staff (opens in a new tab)                                                                                                                    |
| `CONSOLE_PROMETHEUS_URL` | Link shown to staff (opens in a new tab)                                                                                                                    |

Grafana and Prometheus are not published by the production compose file; reach them through your own proxy or an SSH tunnel and put that address in the link variables. See [monitoring.md](monitoring.md).

## Development

`npm run dev` starts everything, and **the whole product is on one address: http://localhost:5173** (the app at `/`, the console at `/console/`), exactly like production behind Caddy. The web dev server proxies `/api` to the API and `/console` to the console's own dev server, which listens on an internal port (5174) that you never need to open. The session cookie is shared because it is one origin. Tests: `npm test --workspace @go-short/console` (MSW, real routes, role-based UI).
