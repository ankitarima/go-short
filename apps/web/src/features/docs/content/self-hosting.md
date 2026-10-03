---
title: Self-hosting
description: Run goShort on your own server with Docker.
area: guides
section: Guides
order: 11
---

goShort is open source and designed to run on one server with Docker Compose, or on a self-hosted platform such as Coolify.

## What you need

- A Linux server with Docker Engine and the Compose plugin.
- Two DNS records pointing at the server: one for the app (for example `app.example.com`) and one for the short-link domain (for example `go.example.com`).
- Ports 80 and 443 open.

## Install

```bash
git clone <your copy of the repository> goshort && cd goshort
cp .env.production.example .env.production
# fill in hostnames and generate each secret with: openssl rand -hex 32
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
./scripts/smoke.sh https://app.example.com
```

The stack runs the web app and API, the redirect service, a background worker, PostgreSQL and Valkey. HTTPS certificates are obtained automatically.

## After installing

1. Create your account and workspace.
2. Download the free GeoIP database so country and city analytics work.
3. Set up regular **backups** and test a restore.
4. Optionally enable the **monitoring** profile (Prometheus and Grafana).

## Things to plan for

- **Email**: the only email provider included does not send mail, so password-reset and invitation emails are not delivered until a provider is added.
- **Custom domains** get certificates automatically with the bundled Caddy setup. On Coolify each domain is added to the proxy by hand.

The repository's `docs/` folder contains the full guides for deployment, backups, Coolify, monitoring and security.
