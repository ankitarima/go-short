# Analytics

```mermaid
flowchart LR
  R[Redirect] -->|event| Q[BullMQ analytics-events]
  Q --> W[Worker batch]
  W --> UA[UA parse + bot flag]
  W --> G[GeoIP local mmdb]
  W --> H[Day-salted IP hash]
  W --> CE[(ClickEvent bulk insert)]
  W --> AD[(AnalyticsDaily / DimensionDaily upsert)]
```

The redirect process only enqueues `{eventId, linkId, workspaceId, campaignId, timestamp, ip, userAgent, referer, acceptLanguage}`. Parsing, geo and storage all happen in the worker. Raw IPs live only in the queue payload (short-lived) and are never written to Postgres; `ipHash` uses a per-day salt derived from `SESSION_SECRET`.

## Accuracy (read this before trusting a number)

- **Unique visitors are approximate**: hash(day-salted IP + user-agent), counted once per link per UTC day. Shared NATs undercount; changing networks overcounts.
- **Bot detection is heuristic** (user-agent patterns). Bot clicks are stored and counted separately, never dropped.
- **GeoIP is approximate**, especially city/region, and VPNs/mobile carriers distort it.
- **Referrers are often absent** (privacy settings, apps, QR scans).
- **Time zones**: rollups are bucketed by UTC day. Non-UTC dashboards are approximate at day edges.

Operators are responsible for compliance with the privacy laws that apply to them; this software does not make a deployment compliant on its own.

## Implementation

### Publishing (redirect service)

`BullmqPublisher` buffers events in memory and enqueues them as **batches** on the `analytics-events` queue: one BullMQ job per `ANALYTICS_BATCH_FLUSH_MS` (default 250 ms) or `ANALYTICS_BATCH_MAX` (default 500) events, whichever comes first. One job per click would cost several Redis round trips per redirect; batching makes that roughly 100x fewer operations at burst rates.

- `publish()` is synchronous and never throws or waits.
- If the queue is unreachable, events stay buffered and are retried (not more than about once a second); memory is bounded by `ANALYTICS_BUFFER_MAX` (default 20,000), beyond which the **oldest** events are dropped, counted and logged.
- On shutdown the buffer is drained with a deadline. A hard crash can lose at most the unflushed buffer (about one flush interval). This is an accepted trade-off: analytics is secondary to redirects.
- Jobs are retried 5 times with exponential backoff (2 s, 4 s, ...), then **kept for 14 days** (up to 10,000) in the failed set for inspection (the dead-letter queue); completed jobs are pruned after an hour.

### Processing (worker)

`BatchProcessor.process()` handles one job in **one Postgres transaction**:

1. Validate each event (malformed ones are dropped and counted, never failing the batch); enrich with user agent, bot flag, GeoIP, referrer host, language and the day-salted hashes.
2. Bulk insert into `ClickEvent` with `ON CONFLICT DO NOTHING RETURNING id`. Only rows that were actually inserted continue, so a redelivered or retried batch can never be counted twice (verified end to end).
3. Insert `DailyVisitor` rows the same way; a visitor counts as new for (day, link) only if its row did not exist.
4. Upsert `AnalyticsDaily` (clicks, unique visitors, device split) per (day, link, isBot) and `AnalyticsDimensionDaily` (country, region, city, device, browser, OS, referrer, UTM source/medium/campaign) with additive `ON CONFLICT DO UPDATE`. Rows are sorted by key before writing so concurrent workers lock in the same order.

If anything fails, the whole transaction rolls back and BullMQ retries the job.

### What is stored, and what is not

- **Never stored:** raw IP addresses, full referrer URLs (only the host), query strings, GeoIP coordinates.
- `visitorHash` and `ipHash` = truncated SHA-256 over a **per-UTC-day salt** (HMAC of the date under `SESSION_SECRET`) plus the IP (and user agent for `visitorHash`). Rotating `SESSION_SECRET` also changes future hashes; it does not affect stored aggregates.
- `ipHash` is stored only when the workspace has IP hashing enabled (the default). `visitorHash` is always computed because unique visitors need it.
- Bot clicks are stored, flagged `isBot`, and aggregated in separate rows so the UI can include or exclude them. The workspace `filterBots` setting changes what is shown, not what is stored.

### Cardinality caps

Referrer, region and city values are controlled by visitors or the network, so per (link, day) only the first **100** distinct values of each are kept; anything beyond that is counted under `other`, preserving the click total. Without this, a script sending random `Referer` headers could grow the rollup tables without bound.

### Known limitations (by design, documented rather than hidden)

- **Unique visitors across a date range = the sum of daily uniques.** Because the salt rotates daily (so people cannot be tracked across days), a returning visitor counts once per day. Multi-day totals therefore overstate true distinct people.
- **Campaign attribution in daily rollups follows the link's campaign at processing time**, so moving a link to another campaign mid-day shifts that day's rollup. Raw `ClickEvent` rows keep the campaign at click time.
- **UTM values in analytics come from the link's configuration**, not from visitors (short URL query strings are not forwarded), so they are bounded and trustworthy for attribution, but they are looked up when the batch is processed (cached up to 60 s).
- Worker memory includes the GeoIP database (about 130 MB for DB-IP city-lite).
