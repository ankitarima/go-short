#!/usr/bin/env bash
# Seeds the load-test fixture (default 100,000 links) into the Postgres of a running compose stack and
# writes a throwaway API key to load/.loadtest.env (git-ignored).
#
#   ./load/seed.sh                 # production compose stack, 100,000 links
#   LINKS=1000000 ./load/seed.sh
#
# NEVER run this against a database with real data: it creates a user, a workspace and an API key that
# exist only for testing (the workspace/user named "loadtest" are replaced on every run).
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
LINKS="${LINKS:-100000}"
KEY="gs_$(openssl rand -hex 4)_$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | cut -c1-43)"
[[ "$KEY" =~ ^gs_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$ ]] || { echo "bad key shape" >&2; exit 1; }

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -c \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v links=$LINKS -v apikey='$KEY'" < load/seed.sql
umask 077
{ echo "LOAD_API_KEY=$KEY"; echo "LOAD_LINKS=$LINKS"; } > load/.loadtest.env
echo "Seeded $LINKS links. API key written to load/.loadtest.env"
