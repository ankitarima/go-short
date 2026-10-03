#!/usr/bin/env bash
# Runs the k6 load tests against a running compose stack, level by level, with accounting.
#
#   ./load/seed.sh                                  # once: 100,000 links + an API key
#   ./load/run.sh redirect                          # 100, 500, 1000, 2000 requests/s, 60 s each
#   RATES="500 2000" DURATION=30s ./load/run.sh redirect
#   ./load/run.sh api
#   K6_ENV="HOT_SHARE=1 MISS_SHARE=0" FLUSH=0 ./load/run.sh redirect   # override the traffic mix
#
# For each level it: clears the redirect cache (so every level starts cold), samples container CPU and
# memory, runs k6 from a container on the stack's network, waits for the analytics queue to drain, and
# compares stored click events with the redirects that were served. Output: load/results/<timestamp>/.
#
# READ THE RESULTS HONESTLY: the load generator, the stack and (on a laptop) Docker's VM all share the
# same CPUs. Numbers from one machine are not capacity statements for another.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:?usage: run.sh redirect|api}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PROJECT_NETWORK="${PROJECT_NETWORK:-goshort_internal}"
DURATION="${DURATION:-60s}"
RATES="${RATES:-100 500 1000 2000}"
FLUSH="${FLUSH:-1}"
TARGET="${TARGET:-http://redirect:4001}"
HOST_HEADER="${HOST_HEADER:-$(grep -E '^DEFAULT_SHORT_DOMAIN=' "$ENV_FILE" | cut -d= -f2)}"
# shellcheck disable=SC1091
set -a; . load/.loadtest.env; set +a
OUT="load/results/$(date -u +%Y%m%dT%H%M%SZ)-$MODE${LABEL:+-$LABEL}"
mkdir -p "$OUT"

# Refuse to measure a stack that is not healthy (a crash-looping service makes every number meaningless).
for svc in api redirect worker postgres valkey; do
  id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
  state="$([ -n "$id" ] && docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
  [ "$state" = healthy ] || { echo "preflight: $svc is '$state', not healthy; aborting" >&2; rm -rf "$OUT"; exit 1; }
done

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
vk() { dc exec -T valkey sh -c "valkey-cli -a \"\$REDISCLI_AUTH\" --no-auth-warning $*"; }
psqlq() { dc exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"$1\""; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

sampler() { # CSV: epoch,name,cpu%,mem usage   (every ~2 s until the file STOP exists)
  while [ ! -f "$1.stop" ]; do
    docker stats --no-stream --format "$(date +%s),{{.Name}},{{.CPUPerc}},{{.MemUsage}}" \
      $(docker ps --filter "network=$PROJECT_NETWORK" --format '{{.Names}}' | grep -E 'goshort-(api|redirect|worker|postgres|valkey|web)-[0-9]+|goshort-k6|gs-caddy') >> "$1" 2>/dev/null || true
  done
}

scrape() { # $1 service, $2 port, $3 output file: the service's own /metrics (resets the event-loop lag window)
  dc exec -T "$1" node -e "fetch('http://127.0.0.1:$2/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>process.stdout.write(t))" > "$3" 2>/dev/null || true
}
clicks() { psqlq "select count(*) from \\\"ClickEvent\\\" where \\\"workspaceId\\\"='lt_ws'"; }
queue_depth() { # waiting + active analytics batches
  local w a; w="$(vk llen bull:analytics-events:wait | tr -d '\r')"; a="$(vk llen bull:analytics-events:active | tr -d '\r')"; echo $((w + a)); }

run_level() { # $1 = rate
  local rate="$1" tag="$MODE-$1" stats="$OUT/stats-$MODE-$1.csv"
  log "== $MODE @ ${rate}/s for $DURATION"
  if [ "$MODE" = redirect ] && [ "$FLUSH" = 1 ]; then
    vk "--scan --pattern 'link:*' | xargs -r valkey-cli -a \"\$REDISCLI_AUTH\" --no-auth-warning del" >/dev/null || true
  fi
  local before; before="$(clicks)"
  for sp in "redirect 9102" "worker 9103" "api 9101"; do set -- $sp; scrape "$1" "$2" "$OUT/before-$1-$tag.txt"; done   # also opens a fresh event-loop lag window
  : > "$stats"; rm -f "$stats.stop"; sampler "$stats" & local spid=$!
  local k6args=(run --summary-export "/results/$tag.json" -e "RATE=$rate" -e "DURATION=$DURATION")
  for kv in ${K6_ENV:-}; do k6args+=(-e "$kv"); done   # e.g. K6_ENV="HOT_SHARE=1 MISS_SHARE=0"
  if [ "$MODE" = redirect ]; then
    k6args+=(-e "BASE_URL=$TARGET" -e "HOST=$HOST_HEADER" -e "LINKS=$LOAD_LINKS" /load/redirect.js)
  else
    k6args+=(-e "BASE_URL=${TARGET_API:-http://api:4000}" -e "API_KEY=$LOAD_API_KEY" -e "LINKS=$LOAD_LINKS" /load/api.js)
  fi
  set +e
  docker run --rm --name goshort-k6 --network "$PROJECT_NETWORK" -v "$PWD/load:/load:ro" -v "$PWD/$OUT:/results" grafana/k6:latest "${k6args[@]}" > "$OUT/k6-$tag.txt" 2>&1
  local code=$?
  set -e
  for sp in "redirect 9102" "worker 9103" "api 9101"; do set -- $sp; scrape "$1" "$2" "$OUT/metrics-$1-$tag.txt"; done
  touch "$stats.stop"; wait "$spid" 2>/dev/null || true
  # drain
  local t0 drain=0 q; t0=$(date +%s)
  while :; do q="$(queue_depth)"; [ "$q" = 0 ] && break; [ $(( $(date +%s) - t0 )) -gt 300 ] && { drain=-1; break; }; sleep 1; done
  [ "$drain" = -1 ] || drain=$(( $(date +%s) - t0 ))
  sleep 2
  local after served; after="$(clicks)"
  served="$(python3 -c "import json;print(int(json.load(open('$OUT/$tag.json'))['metrics'].get('redirects_302',{}).get('count',0)))")"
  printf '{"k6_exit":%s,"drain_seconds":%s,"served_302":%s,"events_stored":%s}\n' "$code" "$drain" "$served" "$((after - before))" > "$OUT/acct-$tag.json"
  python3 load/summarize.py "$OUT/$tag.json" "$stats" "$rate" "$OUT/acct-$tag.json" "$OUT" "$tag" >> "$OUT/summary.jsonl"
  log "   k6 exit=$code  drain=${drain}s  served302=$served  stored=$((after - before))"
}

case "$MODE" in
  redirect) for r in $RATES; do run_level "$r"; sleep "${COOLDOWN:-20}"; done ;;
  api) RATES="${RATES_API:-25 50 100}"; for r in $RATES; do run_level "$r"; sleep "${COOLDOWN:-20}"; done ;;
  *) echo "mode must be redirect or api" >&2; exit 2 ;;
esac
log "results in $OUT (summary.jsonl, k6-*.txt, stats-*.csv)"
