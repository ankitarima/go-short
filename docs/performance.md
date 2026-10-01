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

### With the analytics pipeline on (BullMQ publisher + worker running), Valkey 8

Same machine and method as above (this is the shipped stack: Valkey, redirect service, one worker with concurrency 4, Postgres in Docker).

| Scenario                      | Connections | Requests/s | p50  | p97.5 | p99   | max    | Errors |
| ----------------------------- | ----------- | ---------- | ---- | ----- | ----- | ------ | ------ |
| Cached redirect, analytics ON | 50          | ~27,000    | 1 ms | 4 ms  | 5 ms  | 14 ms  | 0      |
| Cached redirect, analytics ON | 200         | ~32,000    | 5 ms | 11 ms | 13 ms | 120 ms | 0      |

Click accounting after the runs (620,513 stored events vs. 620,262 completed requests + 250 in-flight at the cutoffs + 1 warm-up request): **no lost and no duplicated events**; `AnalyticsDaily` totals equal the raw `ClickEvent` count; the queue drained within a second of the load stopping; no failed jobs; no errors in either service log.

Notes:

- Compared with the 35k req/s baseline (analytics off, Redis 7.4) the cost of building and batching events is roughly 20-25 %; the redirect stays far above the 2,000 req/s burst target on a single core-bound process.
- The worker does not compete with the redirect for the request path: it only consumes the queue. Under sustained overload the queue would grow (visible as waiting jobs) while redirects continue; this is covered by the "worker down" pipeline test, but queue-depth behaviour at 2,000+ req/s for minutes belongs to the k6 suite.
- The worker's bulk-insert transaction is the throughput limit of the analytics side, not the redirect. Raise `WORKER_CONCURRENCY` or run more worker containers if the queue backlog grows.

Reproduce: `npm run build -w @go-short/redirect`, `npx tsx --env-file=.env scripts/seed-bench.ts`, start `apps/redirect/dist/server.js` with `LOG_LEVEL=warn`, then `npx autocannon@8 -c 50 -d 10 http://localhost:4001/bench1`.
