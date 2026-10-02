# Monitoring

Prometheus metrics from every process, a ready-made Grafana setup, and alert rules. Everything here is free and open source (see [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md)).

## What is exposed, and where

Each process serves `GET /metrics` on **its own port, separate from the public listener**, so a reverse proxy cannot expose it by accident:

| Process  | Port (default) | Config var              |
| -------- | -------------- | ----------------------- |
| api      | 9101           | `API_METRICS_PORT`      |
| redirect | 9102           | `REDIRECT_METRICS_PORT` |
| worker   | 9103           | `WORKER_METRICS_PORT`   |

- `METRICS_HOST` defaults to `127.0.0.1`. Containers on a private network need `0.0.0.0`; in production that **requires `METRICS_TOKEN`** (startup fails otherwise), and Prometheus sends it as `Authorization: Bearer <token>`. The comparison is constant-time.
- `METRICS_ENABLED=false` turns the metrics port off entirely.
- Never publish these ports to the internet. Bind them to a private/Docker network only.

Metric labels are deliberately low-cardinality: route **patterns** (`/api/v1/workspaces/:id/links`), never raw paths, ids, slugs, hostnames or emails; all unmatched URLs share one `unmatched` label, so scanners cannot grow the series count. Tests assert this.

### Metrics

| Metric                                                                          | Service  | Meaning                                                                                                                      |
| ------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `goshort_redirect_requests_total{outcome}`                                      | redirect | `redirect`, `not_found`, `disabled`, `expired`, `unavailable`, `password_page`, `unlock_*`, `bad_host`, `unsafe_destination` |
| `goshort_redirect_cache_total{result}`                                          | redirect | `hit`, `negative_hit`, `miss` (served from Postgres), `redis_error`                                                          |
| `goshort_redirect_duration_seconds`                                             | redirect | Time inside the service for a successful short-link GET (not network time)                                                   |
| `goshort_analytics_buffered_events`                                             | redirect | Click events held in memory; stays above 0 only while the queue is unreachable                                               |
| `goshort_analytics_publish_total{event}`                                        | redirect | `published` / `dropped` events and `failed` enqueue attempts                                                                 |
| `goshort_http_requests_total{method,route,status}`                              | api      | Requests by route pattern                                                                                                    |
| `goshort_http_request_duration_seconds{method,route}`                           | api      | Latency histogram                                                                                                            |
| `goshort_logins_total{result}`, `goshort_rate_limited_total{limiter}`           | api      | Login outcomes and limiter rejections (credential-stuffing signal)                                                           |
| `goshort_analytics_batches_total{result}`, `..._batch_duration_seconds`         | worker   | Batches processed and their duration                                                                                         |
| `goshort_analytics_events_total{outcome}`                                       | worker   | `inserted`, `duplicate` (idempotent redelivery), `invalid`                                                                   |
| `goshort_queue_jobs{queue,state}`                                               | worker   | waiting / active / delayed / failed per queue, read from Valkey at scrape time                                               |
| `goshort_webhook_jobs_total{result}`, `goshort_cleanup_runs_total{task,result}` | worker   | Webhook deliveries; scheduled cleanup runs                                                                                   |
| `nodejs_*`, `process_*`                                                         | all      | Default Node.js runtime metrics (event-loop lag, memory, GC)                                                                 |

Every series carries a `service` label (`api`, `redirect`, `worker`).

## Run the local stack

```bash
npm run dev:infra
# .env: METRICS_HOST=0.0.0.0   (so the Prometheus container can reach the host processes)
npm run dev
docker compose -f docker-compose.dev.yml -f docker-compose.monitoring.yml up -d
```

- Prometheus: http://localhost:9090 (targets under Status > Targets, alerts under Alerts)
- Grafana: http://localhost:3000, user `admin`, password `admin` (set `GRAFANA_ADMIN_PASSWORD` to change it). Dashboards are provisioned into the **goShort** folder.
- If you set `METRICS_TOKEN`, point `METRICS_TOKEN_FILE` at a file containing it (the compose file mounts it for Prometheus).
- Postgres and Valkey are scraped through `postgres_exporter` and `redis_exporter`.

Ports are bound to `127.0.0.1`. This compose file is for development. In production, use the `monitoring` profile of `docker-compose.prod.yml` ([deployment.md](deployment.md)): it scrapes the services by name on the private network with the `METRICS_TOKEN`, and Grafana is reachable only through an SSH tunnel. The same dashboards and rules are used.

## Dashboards

Provisioned from `docker/monitoring/grafana/dashboards/` (read-only in the UI; edit the JSON in git):

- **goShort / Redirects**: health, throughput by outcome, handling-time percentiles, cache hit ratio and fallbacks, password-link attempts, analytics buffering/drops.
- **goShort / API**: request rate, 5xx ratio, latency, busiest and slowest routes, login and rate-limit signals.
- **goShort / Pipeline and infrastructure**: queue depth by state, batch rate/duration, event outcomes, webhooks, cleanup runs, Postgres and Valkey health.

Every dashboard query was executed against a live Prometheus while real traffic ran through the stack (browser, API, redirect, worker, queue, Postgres).

## Alerts

`docker/monitoring/prometheus/rules/goshort.yml` (validated with `promtool check rules`) covers: service/Postgres/Valkey down, redirect backend errors, slow redirects, degraded cache, protected-link brute force, **dropped analytics events**, growing buffer, queue backlog, failed jobs, failing batches, API 5xx ratio, login-failure spikes and event-loop lag.

**The thresholds are starting points, not measured limits.** Tune them against your own traffic. Alertmanager (routing to email/Slack/PagerDuty) is not included: add it, or use Grafana alerting, if you want notifications; rules show up in Prometheus either way.

## Cost of instrumentation

Counters and one histogram observation per redirect are in-memory increments. No load-test numbers exist yet (phase 17); do not read anything into this page about throughput.
