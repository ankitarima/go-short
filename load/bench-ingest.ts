/**
 * Analytics-pipeline benchmark, WITHOUT the redirect service: pushes ready-made batches into the BullMQ
 * queue and measures how fast the worker turns them into rows. Isolates ingestion capacity (events/s)
 * from redirect capacity. Needs the load fixture (load/seed.sh), the stack running with
 * load/docker-compose.load.yml (publishes Valkey on 127.0.0.1:6380), and the worker running.
 *
 *   REDIS_URL=redis://:<VALKEY_PASSWORD>@127.0.0.1:6380 DATABASE_URL=postgresql://...@127.0.0.1:5433/goshort \
 *     BATCHES=120 npx tsx load/bench-ingest.ts
 */
import { randomUUID } from 'node:crypto';
import {
  QUEUES,
  ANALYTICS_JOB_OPTIONS,
  type AnalyticsBatch,
  type AnalyticsEvent,
} from '@go-short/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';

const BATCHES = Number(process.env.BATCHES ?? 120);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 420); // ~ what the redirect service flushes at 1,700 req/s
const LINKS = Number(process.env.LOAD_LINKS ?? 100000);
const HOT = 1000;
const AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
];
const REFERERS = [
  null,
  null,
  'https://www.google.com/',
  'https://t.co/abc',
  'https://www.instagram.com/',
];
const r = (n: number) => Math.floor(Math.random() * n);

function event(): AnalyticsEvent {
  const i = Math.random() < 0.6 ? 1 + r(HOT) : 1 + r(LINKS);
  return {
    eventId: randomUUID(),
    linkId: 'lt_l' + String(i).padStart(7, '0'),
    workspaceId: 'lt_ws',
    campaignId: 'lt_c' + String((i % 100) + 1).padStart(3, '0'),
    timestamp: Date.now(),
    ip: `${11 + r(212)}.${r(256)}.${r(256)}.${1 + r(254)}`,
    userAgent: AGENTS[r(AGENTS.length)]!,
    referer: REFERERS[r(REFERERS.length)]!,
    acceptLanguage: 'en-US,en;q=0.9',
    forwardedFor: null,
    qrId: null,
  };
}

const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const queue = new Queue<AnalyticsBatch>(QUEUES.analyticsEvents, { connection });
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const count = async () =>
  Number(
    (await db.query(`select count(*) from "ClickEvent" where "workspaceId"='lt_ws'`)).rows[0].count,
  );

if (process.env.RESET === '1') {
  // Fresh analytics tables so every variant starts from the same state (load-test databases only).
  await db.query(
    'TRUNCATE "ClickEvent","AnalyticsDaily","AnalyticsDimensionDaily","DailyVisitor","AnalyticsBucket"',
  );
  await db.query('CHECKPOINT');
}
await queue.drain();
const wal = async () =>
  (
    await db.query(
      `select wal_records::float8 r, wal_fpi::float8 fpi, wal_bytes::float8 b from pg_stat_wal`,
    )
  ).rows[0] as { r: number; fpi: number; b: number };
const ckpt = async () =>
  (await db.query(`select num_requested::int req, num_timed::int timed from pg_stat_checkpointer`))
    .rows[0] as { req: number; timed: number };
const wal0 = await wal();
const ck0 = await ckpt();
const before = await count();
const total = BATCHES * BATCH_SIZE;
const t0 = Date.now();
for (let b = 0; b < BATCHES; b++) {
  const batchId = randomUUID();
  await queue.add(
    'batch',
    { batchId, events: Array.from({ length: BATCH_SIZE }, event) },
    { ...ANALYTICS_JOB_OPTIONS, jobId: batchId },
  );
}
const enqueued = Date.now();
for (;;) {
  const c = await queue.getJobCounts('waiting', 'active', 'delayed');
  if (c.waiting + c.active + c.delayed === 0) break;
  await new Promise((r) => setTimeout(r, 250));
}
const done = Date.now();
await new Promise((r) => setTimeout(r, 500));
const stored = (await count()) - before;
const secs = (done - t0) / 1000;
console.log(
  `${total} events in ${BATCHES} batches of ${BATCH_SIZE}: drained in ${secs.toFixed(1)} s = ${(total / secs).toFixed(0)} events/s ` +
    `(enqueue took ${((enqueued - t0) / 1000).toFixed(1)} s); stored ${stored}${stored === total ? ' (exact)' : ' (MISMATCH)'}`,
);
const wal1 = await wal();
const ck1 = await ckpt();
console.log(
  `WAL: ${((wal1.b - wal0.b) / stored / 1024).toFixed(1)} KiB per event, ${((wal1.fpi - wal0.fpi) / stored).toFixed(2)} full-page images per event, ` +
    `${((wal1.b - wal0.b) / 1048576).toFixed(0)} MiB total; checkpoints: ${ck1.req - ck0.req} requested + ${ck1.timed - ck0.timed} timed`,
);
await queue.close();
await connection.quit();
await db.end();
