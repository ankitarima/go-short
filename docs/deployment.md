# Deployment

Two supported ways to run goShort in production, both built from the same `Dockerfile`:

| Option                                 | Compose file                 | Who terminates TLS                          | Custom domains                                         |
| -------------------------------------- | ---------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| **Standalone** (one host, Docker only) | `docker-compose.prod.yml`    | Caddy in the stack, automatic Let's Encrypt | Automatic, on demand, only for verified ones           |
| **Coolify** (self-hosted PaaS)         | `docker-compose.coolify.yml` | Coolify's proxy (Traefik)                   | Added to Coolify by hand, see [coolify.md](coolify.md) |

Everything is free and open source. Nothing here needs a paid service.

## What runs

```
internet ──► Caddy ─┬─► web app (static files)        APP_DOMAIN
                    ├─► api  :4000   /api, /openapi.json   (APP_DOMAIN only)
                    └─► redirect :4001   every other hostname (short links)
                         │         worker (analytics, webhooks, cleanup)
                         └── Valkey ◄──┘      Postgres
```

- **migrate** is a one-shot container that runs `prisma migrate deploy` before the apps start. The Prisma CLI exists only in that image; the runtime images do not contain it.
- Only Caddy publishes ports to the internet (80, 443). Valkey and the three metrics ports are on a private Docker network; Postgres is also published, but on the server's loopback only (`127.0.0.1:15432`), for tunnelled access: [database-access.md](database-access.md).
- Runtime containers run as a non-root user, with a read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, an init process, log rotation, health checks and memory limits. **The memory limits are conservative starting points, not measured requirements**; the load tests (phase 17) are what should set them.

## Requirements

- A Linux server with Docker Engine 24+ and the Compose plugin (v2). Memory: the default limits add up to about 3 GB; smaller hosts should lower them and expect less headroom.
- DNS `A`/`AAAA` records for `APP_DOMAIN` (e.g. `app.example.com`) and `DEFAULT_SHORT_DOMAIN` (e.g. `go.example.com`) pointing at the server, and ports 80/443 open.
- For **custom domains** customers CNAME their hostname to your short domain; Caddy then obtains a certificate the first time that hostname is requested, but only if the API confirms it is verified ([custom-domains.md](custom-domains.md)).

## Standalone install

```bash
git clone <your fork or this repository> goshort && cd goshort
cp .env.production.example .env.production
# fill in the hostnames, ACME_EMAIL and every empty secret:
#   openssl rand -hex 32     (POSTGRES_PASSWORD, VALKEY_PASSWORD, SESSION_SECRET)
#   openssl rand -hex 24     (INTERNAL_API_TOKEN, METRICS_TOKEN)
chmod 600 .env.production

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps        # wait for healthy
./scripts/smoke.sh https://app.example.com
```

Compose refuses to start if a required secret is empty. The apps additionally refuse placeholder-looking or low-variety `SESSION_SECRET`s in production.

Then:

1. Open `https://APP_DOMAIN`, register, and create a workspace. **The first account is an ordinary user.** To use the platform console at `https://APP_DOMAIN/console`, make yourself the first super admin (`scripts/grant-admin.ts` needs database access from the host, which this stack does not expose, so use the database container). Later staff are added from the console itself ([console.md](console.md)):
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres \
     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update \"User\" set \"systemRole\"='"'"'SUPER_ADMIN'"'"' where email='"'"'you@example.com'"'"'"'
   ```
2. Download the GeoIP database once (country/city analytics are empty without it), then restart the worker so it loads it:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml --profile tools run --rm geoip
   docker compose --env-file .env.production -f docker-compose.prod.yml restart worker
   ```
   DB-IP's data is CC BY 4.0: attribute it wherever you show geolocation. Re-run monthly if you want fresh data.
3. Set up backups ([backup-restore.md](backup-restore.md)) **before** you have data you care about.
4. Optional monitoring: add `GRAFANA_ADMIN_PASSWORD` to `.env.production` and start with `--profile monitoring`. Grafana listens on `127.0.0.1:3000` of the server; reach it with `ssh -L 3000:127.0.0.1:3000 you@server`. See [monitoring.md](monitoring.md).

## Configuration

Set in `.env.production` (the full list of application settings is in `.env.example` and `packages/config`):

| Variable                                                                       | Purpose                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_DOMAIN`, `DEFAULT_SHORT_DOMAIN`                                           | Public hostname of the app; and the FIRST shared short domain (a first-boot seed: more are added in the console)                        |
| `ACME_EMAIL`                                                                   | Contact address for Let's Encrypt (standalone only)                                                                                     |
| `POSTGRES_*`, `VALKEY_PASSWORD`                                                | Database credentials (the containers are not reachable from outside the Docker network)                                                 |
| `SESSION_SECRET`                                                               | Keys webhook-secret encryption and the daily visitor-hash salts. **Back it up; changing it makes stored webhook secrets undecryptable** |
| `INTERNAL_API_TOKEN`                                                           | Shared between Caddy and the API for the on-demand TLS check                                                                            |
| `METRICS_TOKEN`                                                                | Bearer token for `/metrics` on the private metrics ports                                                                                |
| `HTTP_PORT`, `HTTPS_PORT`                                                      | Host ports for Caddy (default 80/443)                                                                                                   |
| `REDIRECT_STATUS`, `WORKER_CONCURRENCY`, `LOG_LEVEL`, `FEATURE_CUSTOM_DOMAINS` | Behaviour; see `.env.example`                                                                                                           |

Never commit `.env.production`; it is git-ignored. **Email:** the only email provider implemented is a console one that does not send anything (verification, password-reset and invitation messages are not delivered; in production their bodies are deliberately not logged either). Password reset and invitations therefore do not work for real users until an SMTP provider is added. Plan for that before inviting people.

## Updating

```bash
./scripts/backup.sh                                   # always first: migrations only go forward
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
./scripts/smoke.sh https://app.example.com
```

`migrate` runs again on every `up` and applies new migrations. To roll back a bad release, check out the previous version and [restore](backup-restore.md) the backup taken before the update (a code-only rollback is safe only when the release had no migration).

## Edge routing details

`docker/caddy/Caddyfile`:

- `APP_DOMAIN` serves the SPA (security headers from `apps/web/security-headers.ts`, immutable caching for hashed assets, `no-cache` for the HTML shell) and proxies exactly `/api/*` and `/openapi.json` to the API (the public docs at `/docs` are part of the SPA). The slash in `/api/*` matters: the SPA has a client route `/api-keys`. `/metrics`, `/internal/*`, `/ready` and the internal Swagger UI (`/api-docs`) are **not** proxied.
- Every other hostname goes to the redirect service, with an on-demand certificate. Caddy asks `GET /internal/tls-check?domain=…` on the API first; only the shared domain and **verified** custom domains get a 200, so random `Host` headers cannot make Caddy request certificates or burn Let's Encrypt rate limits.
- Plain HTTP for short domains is redirected to HTTPS.

## Verified, and not verified

Verified by running the stack locally from the built images: image builds; migrations; all services healthy under the read-only/non-root settings; the Caddy app site (headers, SPA fallback, `/api-keys` vs `/api/`, gzip, asset caching); API through the edge; the on-demand TLS check (200 for the shared domain, 404 for unknown hosts, 403 for a wrong token; Caddy then proceeded to issue for the approved name, which fails for `.localhost` as expected); short-link routing and click ingestion through Valkey (with a password) to the worker and Postgres; GeoIP download; the monitoring profile (all scrape targets up, token enforced, dashboards provisioned); the Coolify variant's routing behind a plain-HTTP front; backup, verify, restore, checksum tamper detection, and cache clearing.

Not verified: certificate issuance from the real Let's Encrypt (needs a public domain), a real Coolify instance, encrypted backups with `age`, IPv6, and any behaviour under load.
