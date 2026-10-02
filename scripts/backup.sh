#!/usr/bin/env bash
# Backs up Postgres (custom-format dump) and the uploaded-files volume, verifies both, and prunes old backups.
#
#   ./scripts/backup.sh                        # production stack (docker-compose.prod.yml + .env.production)
#   COMPOSE_FILE=docker-compose.dev.yml BACKUP_STORAGE=no ./scripts/backup.sh
#
# Environment (all optional):
#   COMPOSE_FILE            compose file of the running stack          (docker-compose.prod.yml)
#   ENV_FILE                env file passed to compose, if it exists    (.env.production)
#   BACKUP_DIR              where backups go                            (./backups)
#   BACKUP_RETENTION_DAYS   delete backups older than this              (14)
#   BACKUP_STORAGE          yes|no: also archive uploaded logos         (yes)
#   BACKUP_AGE_RECIPIENT    an `age` public key: encrypt every file with it (unset = unencrypted)
#
# What is NOT included, on purpose: Valkey (queue state and caches; analytics batches in flight are
# re-derivable or accepted losses), the GeoIP database (re-downloadable), TLS certificates (re-issued).
# BACK UP .env.production SEPARATELY AND SECURELY: without SESSION_SECRET stored webhook secrets cannot
# be decrypted. Copy the files off this host: a backup on the same disk is not a backup.
set -euo pipefail
umask 077

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_STORAGE="${BACKUP_STORAGE:-yes}"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

compose() {
  if [ -f "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose -f "$COMPOSE_FILE" "$@"; fi
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

[ -z "$AGE_RECIPIENT" ] || command -v age >/dev/null || { echo "BACKUP_AGE_RECIPIENT is set but 'age' is not installed (https://github.com/FiloSottile/age)" >&2; exit 1; }
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a number" >&2; exit 1 ;; esac

TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d "$BACKUP_DIR/.tmp-$TS.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT   # a failed run never leaves a partial backup behind

DUMP="goshort-$TS.dump"
log "dumping Postgres"
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner' > "$WORK/$DUMP"
log "verifying the dump is readable"
compose exec -T postgres pg_restore --list < "$WORK/$DUMP" > /dev/null
[ -s "$WORK/$DUMP" ] || { echo "dump is empty" >&2; exit 1; }
FILES=("$DUMP")

if [ "$BACKUP_STORAGE" = "yes" ]; then
  STORE="goshort-storage-$TS.tar"
  log "archiving uploaded files"
  compose exec -T api tar -C /data/storage -cf - . > "$WORK/$STORE"
  tar -tf "$WORK/$STORE" > /dev/null
  FILES+=("$STORE")
fi

if [ -n "$AGE_RECIPIENT" ]; then
  for f in "${FILES[@]}"; do
    age -r "$AGE_RECIPIENT" -o "$WORK/$f.age" "$WORK/$f" && rm "$WORK/$f"
  done
  FILES=("${FILES[@]/%/.age}")
  log "encrypted with age"
fi

(cd "$WORK" && sha256 "${FILES[@]}" > "goshort-$TS.sha256")
for f in "${FILES[@]}" "goshort-$TS.sha256"; do mv "$WORK/$f" "$BACKUP_DIR/$f"; done

log "pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'goshort-*' -mtime "+$RETENTION_DAYS" -delete

log "done:"
( cd "$BACKUP_DIR" && ls -lh "${FILES[@]}" "goshort-$TS.sha256" )
echo "Copy these off this host. Restore with: ./scripts/restore.sh $BACKUP_DIR/${FILES[0]}"
