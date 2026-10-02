#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh, or checks that one is restorable.
#
#   ./scripts/restore.sh --verify backups/goshort-<ts>.dump       # SAFE: restores into a scratch database, compares, drops it
#   ./scripts/restore.sh backups/goshort-<ts>.dump                # REPLACES the live database (asks first)
#   ./scripts/restore.sh --storage backups/goshort-storage-<ts>.tar backups/goshort-<ts>.dump
#
# Options: --verify  --storage FILE  --yes (skip the prompt)  --skip-safety-backup
# Environment: COMPOSE_FILE, ENV_FILE (as in backup.sh); BACKUP_AGE_IDENTITY = age private key file, for *.age files.
#
# A real restore: takes a safety backup of the CURRENT state first, stops api/redirect/worker, restores
# in ONE transaction (all or nothing), starts the services again and clears the redirect cache so
# links that no longer exist in the restored data stop redirecting.
set -euo pipefail
umask 077

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
VERIFY=0; YES=0; SAFETY=1; STORAGE_FILE=""; DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=1 ;;
    --yes) YES=1 ;;
    --skip-safety-backup) SAFETY=0 ;;
    --storage) STORAGE_FILE="${2:?--storage needs a file}"; shift ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) DUMP="$1" ;;
  esac
  shift
done
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "usage: $0 [--verify] [--storage FILE] [--yes] DUMP" >&2; exit 2; }

compose() {
  if [ -f "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose -f "$COMPOSE_FILE" "$@"; fi
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
psql_live() { compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA'; }

WORK="$(mktemp -d)"
SCRATCH=""
cleanup() {
  [ -z "$SCRATCH" ] || compose exec -T postgres sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Verify the checksum next to the file, if there is one.
verify_checksum() {
  local f="$1" dir base
  dir="$(cd "$(dirname "$f")" && pwd)"; base="$(basename "$f")"
  for s in "$dir"/goshort-*.sha256; do
    [ -f "$s" ] || continue
    if grep -q " $base\$" "$s"; then
      (cd "$dir" && grep " $base\$" "$s" | sha256 -c - >/dev/null) || { echo "CHECKSUM MISMATCH for $base: the file is corrupt or was modified" >&2; exit 1; }
      log "checksum ok: $base"; return 0
    fi
  done
  log "no checksum file found for $base (skipping check)"
}
# Decrypt *.age into WORK; echo the path to use.
plain() {
  local f="$1"
  case "$f" in
    *.age)
      command -v age >/dev/null || { echo "'age' is required to read $f" >&2; exit 1; }
      [ -n "${BACKUP_AGE_IDENTITY:-}" ] || { echo "set BACKUP_AGE_IDENTITY to your age private key file" >&2; exit 1; }
      local out
      out="$WORK/$(basename "${f%.age}")"
      age -d -i "$BACKUP_AGE_IDENTITY" -o "$out" "$f"; echo "$out" ;;
    *) echo "$f" ;;
  esac
}

verify_checksum "$DUMP"
[ -z "$STORAGE_FILE" ] || verify_checksum "$STORAGE_FILE"
DUMP_FILE="$(plain "$DUMP")"
compose exec -T postgres pg_restore --list < "$DUMP_FILE" > /dev/null || { echo "not a valid pg_dump custom-format file" >&2; exit 1; }

TABLES='"User" "Workspace" "WorkspaceMember" "Domain" "Campaign" "Link" "QRCode" "ApiKey" "ClickEvent"'
counts() { # $1 = database name; the SQL goes over stdin so the quoted identifiers survive intact
  local sql="" t
  for t in $TABLES; do sql+="select '${t//\"/}', count(*) from $t union all "; done
  sql="${sql% union all };"
  compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=1 -tA -F ' '" <<< "$sql"
}

if [ "$VERIFY" = 1 ]; then
  SCRATCH="goshort_verify_$(date -u +%H%M%S)"
  log "restoring into scratch database $SCRATCH (the live database is not touched)"
  compose exec -T postgres sh -c "createdb -U \"\$POSTGRES_USER\" $SCRATCH"
  compose exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$DUMP_FILE"
  echo; printf '%-18s %10s\n' TABLE ROWS
  counts "$SCRATCH" | awk '{printf "%-18s %10s\n", $1, $2}'
  N="$(counts "$SCRATCH" | wc -l | tr -d ' ')"
  [ "$N" -gt 0 ] || { echo "restored database has no tables" >&2; exit 1; }
  echo; log "OK: the backup restores cleanly. (Compare the rows above with the live system if you want.)"
  if [ -n "$STORAGE_FILE" ]; then tar -tf "$(plain "$STORAGE_FILE")" > /dev/null && log "OK: storage archive is readable"; fi
  exit 0
fi

echo "This REPLACES the live database with: $DUMP"
[ -z "$STORAGE_FILE" ] || echo "and the uploaded files with: $STORAGE_FILE"
if [ "$YES" != 1 ]; then
  read -r -p "Type 'restore' to continue: " ans
  [ "$ans" = "restore" ] || { echo "aborted"; exit 1; }
fi

if [ "$SAFETY" = 1 ]; then
  log "taking a safety backup of the current state first"
  BACKUP_DIR="${BACKUP_DIR:-./backups}" "$(dirname "$0")/backup.sh"
fi

log "stopping api, redirect, worker"
compose stop api redirect worker >/dev/null 2>&1 || true

log "restoring the database in one transaction"
compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error' < "$DUMP_FILE"

if [ -n "$STORAGE_FILE" ]; then
  log "restoring uploaded files"
  compose run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/storage/* /data/storage/.[!.]* 2>/dev/null; tar -C /data/storage -xf -' < "$(plain "$STORAGE_FILE")"
fi

log "starting services"
compose up -d api redirect worker >/dev/null
log "clearing the redirect cache"
compose exec -T valkey sh -c 'valkey-cli -a "$REDISCLI_AUTH" --no-auth-warning --scan --pattern "link:*" | xargs -r valkey-cli -a "$REDISCLI_AUTH" --no-auth-warning del >/dev/null' || log "WARNING: could not clear the cache; run it manually (see docs/backup-restore.md)"
log "restored. Check /ready and sign in."
