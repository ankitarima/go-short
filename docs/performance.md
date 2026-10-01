# Performance

Targets (not guarantees; measure on your own hardware): cached redirect p50 < 20 ms, p95 < 100 ms, p99 < 200 ms; bursts of 1,000–2,000 redirects/s; ~20,000 clicks/day normal load.

## Why the redirect path is fast

Redis `GET` → non-blocking publish → 3xx. No body parsing, no framework, no joins, no UA/GeoIP work, no analytics write. Cache misses are coalesced (single-flight) and Postgres is hit with one indexed join. See [redirect-system.md](redirect-system.md).

## Measurements

### Baseline: redirect service, before analytics is wired in (no-op publisher)

> **Read with care.** Single dev laptop (Apple Silicon, 8 cores, 16 GB), Postgres and Redis in Docker, load generator (`autocannon@8`) on the same machine competing for CPU, one redirect process, 10 s runs, one hot link. This shows relative behaviour and gross regressions, **not** production capacity. The formal k6 suite (100/500/1,000/2,000 RPS on target hardware) is a later phase.

| Scenario                          | Connections | Requests/s | p50  | p97.5 | p99  | Errors |
| --------------------------------- | ----------- | ---------- | ---- | ----- | ---- | ------ |
| Cached redirect (Redis hit)       | 50          | ~35,000    | 1 ms | 2 ms  | 2 ms | 0      |
| Cached redirect (Redis hit)       | 200         | ~35,000    | 5 ms | 8 ms  | 9 ms | 0      |
| Redis stopped (Postgres fallback) | 50          | ~31,000    | 1 ms | 1 ms  | 2 ms | 0      |

Notes:

- The redirect process was CPU-bound at ~89 % of one core at ~35k req/s (RSS ≈ 317 MB), i.e. one core is roughly 17× the 2,000 req/s burst target.
- The Postgres-fallback figure is high because single-flight collapses concurrent lookups for the **same** key into one query. A workload spread over many distinct cold keys will be bounded by Postgres instead; test that with the 100k-link k6 scenario.
- With Redis down the log produced 3 lines in ~15 s (throttled), and the service reconnected by itself when Redis returned.
- These numbers will be re-measured with the BullMQ publisher enabled; the redirect must remain functional under analytics pressure.

Reproduce: `npm run build -w @go-short/redirect`, `npx tsx --env-file=.env scripts/seed-bench.ts`, start `apps/redirect/dist/server.js` with `LOG_LEVEL=warn`, then `npx autocannon@8 -c 50 -d 10 http://localhost:4001/bench1`.
