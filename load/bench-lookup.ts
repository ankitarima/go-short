/**
 * Micro-benchmark of the redirect service's cache-MISS lookup: the Prisma query it runs today versus the
 * same lookup as one parameterised SQL statement through `pg`. Reports wall time and CPU time per lookup,
 * sequentially and with 50 in flight. Needs the load fixture (load/seed.sh) and Postgres reachable.
 *
 *   DATABASE_URL=postgresql://goshort:<password>@127.0.0.1:5433/goshort npx tsx load/bench-lookup.ts
 */
import { getPrisma } from '@go-short/database';
import pg from 'pg';

const HOST = process.env.BENCH_HOST ?? 'go.localhost';
const N = Number(process.env.BENCH_N ?? 5000);
const LINKS = Number(process.env.LOAD_LINKS ?? 100000);
const slug = () => 'k' + String(1 + Math.floor(Math.random() * LINKS)).padStart(6, '0');

const prisma = getPrisma();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const SQL = `SELECT l.id, l."workspaceId", l."campaignId", l."destinationUrl", l."isActive", l."expiresAt",
       (l."passwordHash" IS NOT NULL) AS "hasPassword", l."redirectStatus",
       l."utmSource", l."utmMedium", l."utmCampaign", l."utmTerm", l."utmContent"
  FROM "Link" l JOIN "Domain" d ON d.id = l."domainId"
 WHERE l.slug = $1 AND d.hostname = $2 AND d.status = 'VERIFIED' LIMIT 1`;

const viaPrisma = () =>
  prisma.link.findFirst({
    where: { slug: slug(), domain: { hostname: HOST, status: 'VERIFIED' } },
    select: {
      id: true, workspaceId: true, campaignId: true, destinationUrl: true, isActive: true, expiresAt: true,
      passwordHash: true, redirectStatus: true, utmSource: true, utmMedium: true, utmCampaign: true,
      utmTerm: true, utmContent: true,
    },
  });
const viaPg = () => pool.query(SQL, [slug(), HOST]);

async function run(name: string, fn: () => Promise<unknown>, concurrency: number) {
  for (let i = 0; i < 300; i++) await fn(); // warm-up: connections, plan cache, JIT
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  let left = N;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (left-- > 0) await fn();
    }),
  );
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  console.log(
    `${name.padEnd(8)} concurrency ${String(concurrency).padStart(2)}: ${(N / (wallMs / 1000)).toFixed(0).padStart(6)} lookups/s, ` +
      `${(wallMs / N).toFixed(3)} ms wall and ${(cpuMs / N).toFixed(3)} ms CPU per lookup`,
  );
}

for (const c of [1, 50]) {
  await run('prisma', viaPrisma, c);
  await run('pg', viaPg, c);
}
await pool.end();
await prisma.$disconnect();
