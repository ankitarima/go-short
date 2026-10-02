# Backup and restore

## What is backed up

| Data                                                  | Backed up                   | How                                                                                                           |
| ----------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Postgres (all application data, analytics, audit log) | yes                         | `pg_dump` custom format, verified readable after writing                                                      |
| Uploaded files (QR logos)                             | yes                         | tar of the storage volume (`BACKUP_STORAGE=yes`)                                                              |
| `.env.production` (incl. `SESSION_SECRET`)            | **no, by design: you must** | store it in a password manager or secrets vault; without `SESSION_SECRET` webhook secrets cannot be decrypted |
| Valkey (queues, caches, rate limits)                  | no                          | caches rebuild; queued analytics batches are short-lived; see below                                           |
| GeoIP database, TLS certificates                      | no                          | re-downloaded / re-issued                                                                                     |

Click events in flight (queued but not yet processed) are not in Postgres yet, so a restore loses at most the last few seconds of clicks before the failure. Analytics is secondary to redirects by design ([analytics.md](analytics.md)).

## Taking a backup

```bash
./scripts/backup.sh
```

Writes to `./backups` (override with `BACKUP_DIR`):

```
goshort-<UTC timestamp>.dump          Postgres
goshort-storage-<UTC timestamp>.tar   uploaded files
goshort-<UTC timestamp>.sha256        checksums of the above
```

The script verifies the dump with `pg_restore --list`, the archive with `tar -t`, writes checksums, never leaves a partial backup behind if anything fails, and deletes backups older than `BACKUP_RETENTION_DAYS` (default 14). Files are created `0600`.

**Schedule it** (the host's cron; adjust the path):

```cron
15 3 * * *  cd /opt/goshort && ./scripts/backup.sh >> /var/log/goshort-backup.log 2>&1
```

**Get it off the host.** A backup on the same disk is not a backup. Free, open-source options for copying `./backups` elsewhere: `rclone` (MIT, many cloud/object stores), `restic` (BSD-2, encrypted deduplicated snapshots), `borg` (BSD-3), or plain `rsync`/`scp` to another machine. These are suggestions; this repository does not ship or test them.

### Encryption

Set `BACKUP_AGE_RECIPIENT` to an [age](https://github.com/FiloSottile/age) public key (BSD-3) and every file is encrypted before it is written (`*.age`); keep the private key somewhere other than the server. Restoring needs `BACKUP_AGE_IDENTITY=/path/to/key.txt`. **This path has not been exercised in tests**; do a `--verify` run with your key before relying on it.

## Checking that a backup is restorable

```bash
./scripts/restore.sh --verify backups/goshort-<ts>.dump --storage backups/goshort-storage-<ts>.tar
```

Restores into a scratch database, prints row counts per key table, drops the scratch database, and does not touch the live data. It also checks the checksum. **Do this regularly** (monthly at least, and after any change to the backup setup): an untested backup is a hope, not a backup.

## Restoring

```bash
./scripts/restore.sh backups/goshort-<ts>.dump --storage backups/goshort-storage-<ts>.tar
```

This **replaces** the live database (and files, if `--storage` is given). It asks you to type `restore`, then:

1. Takes a safety backup of the current state (skip with `--skip-safety-backup`, not recommended).
2. Verifies checksums, stops `api`, `redirect` and `worker`.
3. Restores in a single transaction: either everything is replaced or nothing is.
4. Restores the files, starts the services, and deletes the redirect cache entries (`link:*`) so links that no longer exist stop redirecting immediately.

If the cache step reports a warning, clear it by hand:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec valkey sh -c \
  'valkey-cli -a "$REDISCLI_AUTH" --no-auth-warning --scan --pattern "link:*" | xargs -r valkey-cli -a "$REDISCLI_AUTH" --no-auth-warning del'
```

### Disaster recovery on a new host

1. Install Docker, clone the repository, restore `.env.production` from your secrets store.
2. `docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres valkey` and wait until healthy.
3. `./scripts/restore.sh --yes --skip-safety-backup <dump> --storage <tar>` (there is no current state to protect). The `migrate` service runs on the next `up` and brings an older dump up to the current schema.
4. `docker compose ... up -d --build`, point DNS at the new host, run `./scripts/smoke.sh`.

## Verified

Backup, `--verify` (row counts, scratch database dropped afterwards), checksum tamper detection, and a full restore were run against the production compose stack: a link created after the backup was gone after the restore, a link that existed at backup time kept redirecting, and a link that had been cached before the restore returned 404 afterwards.
