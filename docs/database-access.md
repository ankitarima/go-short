# Looking at, and editing, the database

Postgres runs inside Docker and is never reachable from the internet. Two ways in.

## On your own machine (development)

The dev Postgres is published on `127.0.0.1:5432`, so Prisma Studio works directly:

```bash
npm run db:studio          # http://localhost:5555, uses DATABASE_URL from .env
```

Any SQL client works too (`postgresql://goshort:goshort@localhost:5432/goshort`).

## On the server (Coolify or standalone)

Both production compose files publish Postgres on the **server's loopback only**: `127.0.0.1:15432` (override with `POSTGRES_HOST_PORT`). Nothing outside the server can connect to that; you reach it through an SSH tunnel from your laptop:

```bash
# 1. leave this running in one terminal
ssh -N -L 15432:127.0.0.1:15432 youruser@SERVER_IP

# 2. in the repo, in another terminal (POSTGRES_PASSWORD is the value from Coolify's environment)
DATABASE_URL='postgresql://goshort:POSTGRES_PASSWORD@localhost:15432/goshort' npm run db:studio
```

Prisma Studio then opens at `http://localhost:5555` against the production database. A GUI client (TablePlus, DBeaver, DataGrip) works the same way: host `localhost`, port `15432`, or use the client's built-in "SSH tunnel" option with host `127.0.0.1`, port `15432`. Without a tunnel you can also use `psql` inside the container (Coolify: postgres service > Terminal).

After the first deploy with this setting, Coolify recreates the Postgres container once (a few seconds; the data volume is kept and the apps reconnect).

Do not publish the port on `0.0.0.0`, and do not put Prisma Studio behind a public domain: Studio has no sign-in and full write access to every customer's data. That is also why it is not part of the console.

## Editing rows safely

Direct edits skip the application's validation, hashing and audit log.

1. **Back up first** (`./scripts/backup.sh`, see [backup-restore.md](backup-restore.md)). Migrations and edits only go forward.
2. **Redirect caching.** Redirects are cached in Valkey for `REDIRECT_CACHE_TTL_SECONDS` (default 1 hour). If you change a link's destination, status, domain or slug in the database, the old answer can be served until it expires. Clear it with the command in [backup-restore.md](backup-restore.md#restoring) (`link:*` keys).
3. Never put plain text in `passwordHash` (it is an argon2id hash), and never edit `Session` or `AuthToken` rows by hand. To give someone staff access use the console or `create-admin`; to change shared domains use the console's Short domains page.
4. Prefer the console for what it covers (suspending accounts, roles, shared domains): those changes are audited and refresh caches.
