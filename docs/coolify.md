# Deploying on Coolify

[Coolify](https://coolify.io) is an open-source, self-hostable PaaS. goShort ships `docker-compose.coolify.yml` for it. Coolify's proxy (Traefik) owns ports 80/443 and issues certificates, so this variant has no TLS of its own.

> **Status: prepared, not yet run on a real Coolify instance.** The compose file was run locally with a plain-HTTP front standing in for Traefik (routing, headers, health checks and the internal endpoints' hiding were checked), but Coolify itself was not available. Phase 16 is where this gets deployed for real; treat the steps below as the plan and expect small adjustments. Coolify's UI changes between releases; the concepts are stable.

## What differs from the standalone stack

| Topic                | Standalone (`docker-compose.prod.yml`)    | Coolify (`docker-compose.coolify.yml`)                                                             |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TLS and certificates | Caddy, automatic, including on demand     | Coolify/Traefik, per listed domain                                                                 |
| Published ports      | 80/443 (Caddy)                            | none; Coolify's proxy reaches containers on the Docker network                                     |
| `web` container      | `Caddyfile` (HTTPS)                       | `Caddyfile.http` (plain HTTP on :80; app host to SPA/API, everything else to the redirect service) |
| `TRUST_PROXY`        | `1` (Caddy is the only hop)               | `uniquelocal` (Traefik + Caddy, both private addresses)                                            |
| Custom domains       | Issued automatically for verified domains | **You add each one to Coolify by hand** (see below)                                                |

## Steps

1. **Server**: add a server to Coolify (or use its own host). Make sure DNS for `APP_DOMAIN` and `DEFAULT_SHORT_DOMAIN` points at it.
2. **New resource**: Project > New > Application from a Git repository > build pack **Docker Compose**; base directory `/`; compose file `docker-compose.coolify.yml`.
3. **Environment variables** (Environment tab; the same names as `.env.production.example`): `APP_DOMAIN`, `DEFAULT_SHORT_DOMAIN`, `POSTGRES_PASSWORD`, `VALKEY_PASSWORD`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`, `METRICS_TOKEN` (generate with `openssl rand -hex 32`/`24`). `ACME_EMAIL` and `HTTP*_PORT` are not used. Mark them as secrets.
4. **Domains**: on the **`web`** service, set the domains with the container port, for example `https://app.example.com:80,https://go.example.com:80`. Leave the other services without domains.
5. **Deploy.** The `migrate` container runs first. Wait for all services to be healthy.
6. Run `./scripts/smoke.sh https://app.example.com` from your machine.
7. **GeoIP and backups** are the same as the standalone setup, but run through the Coolify host's shell (`docker compose -p <project> ...` against the stack Coolify created) or Coolify's scheduled-task feature; Coolify can also back up databases it manages itself, which does not cover this compose-managed Postgres. Follow [backup-restore.md](backup-restore.md).

## First super admin

No default credentials exist. In Coolify open the **api** service > **Terminal** and run (the password is read from the environment, so it is not an argument; 12+ characters):

```bash
ADMIN_PASSWORD='a long passphrase' node dist/cli/create-admin.js admin@yourdomain.com "Your Name"
```

This creates a verified account with the SUPER_ADMIN role; sign in at `https://APP_DOMAIN/console`. Run it again for an existing email to promote that account instead (its password is left alone); `--role ADMIN|MANAGER` picks a lower role. Further staff are added from the console's Staff page. Clear the command from the terminal history afterwards.

## Custom domains on Coolify

Coolify's proxy issues a certificate only for hostnames it has been told about. When a customer verifies a domain in goShort, add the same hostname to the `web` service's domain list in Coolify (and redeploy/reload the proxy as Coolify requires). The DNS check goShort performs is the same either way; only the certificate step is manual.

If you need fully automatic certificates for arbitrary customer domains, use the standalone stack (Caddy's on-demand TLS) on a server of its own, or run the standalone Caddy on a separate IP in front of Coolify. This is the main reason both variants exist.

## Open questions to settle in phase 16

- Whether Coolify's compose build pack honours every setting used here (`read_only`, `cap_drop`, `init`, `deploy.resources.limits`); it should, as it runs `docker compose`, but confirm.
- Persistent-volume naming and the backup scripts' compose project name under Coolify.
- Whether Coolify's proxy forwards the real client IP in `X-Forwarded-For` as assumed by `TRUST_PROXY=uniquelocal` (check the click events' `forwardedFor`/country after the first real visit).
