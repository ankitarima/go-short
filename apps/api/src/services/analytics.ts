import { Prisma } from '@go-short/database';
import { AppError } from '@go-short/shared';
import type { AnalyticsQuery } from '@go-short/validation';
import type { AppContext } from '../context';

export interface Scope {
  workspaceId: string;
  linkId?: string;
  campaignId?: string;
}
export interface WorkspaceSettings {
  timezone: string;
  filterBots: boolean;
}

export const MAX_RANGE_DAYS = 366;
export const MAX_HOURLY_DAYS = 14;
export const MAX_EVENT_FILTER_DAYS = 31;

const DIM_KEYS: Record<string, string> = {
  COUNTRY: 'countries',
  REGION: 'regions',
  CITY: 'cities',
  DEVICE: 'devices',
  BROWSER: 'browsers',
  OS: 'os',
  REFERRER: 'referrers',
  UTM_SOURCE: 'utmSources',
  UTM_MEDIUM: 'utmMediums',
  UTM_CAMPAIGN: 'utmCampaigns',
  QR_CODE: 'qrCodes',
};

interface Resolved {
  tz: string;
  from: string;
  to: string;
  start: string; // UTC instant (ISO) of local `from` 00:00
  end: string; // UTC instant (ISO), exclusive
  utcFrom: string;
  utcTo: string;
  days: number;
  includeBots: boolean;
  unit: 'day' | 'hour';
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

async function resolveRange(
  ctx: AppContext,
  q: AnalyticsQuery,
  ws: WorkspaceSettings,
): Promise<Resolved> {
  const tz = q.timezone ?? ws.timezone;
  let from = q.from;
  let to = q.to;
  try {
    if (!to)
      to = (
        await ctx.prisma.$queryRaw<
          { d: string }[]
        >`SELECT to_char((now() AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS d`
      )[0]!.d;
    if (!from)
      from = (
        await ctx.prisma.$queryRaw<
          { d: string }[]
        >`SELECT to_char(((${to}::date) - 29), 'YYYY-MM-DD') AS d`
      )[0]!.d;
    const [r] = await ctx.prisma.$queryRaw<{ s: Date; e: Date; days: number }[]>`
      SELECT (((${from}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC') AS s,
             ((((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC') AS e,
             ((${to}::date) - (${from}::date) + 1)::int AS days`;
    const start = r!.s.toISOString();
    const end = r!.e.toISOString();
    if (r!.days < 1) throw new AppError('VALIDATION_ERROR', '`from` must not be after `to`');
    if (r!.days > MAX_RANGE_DAYS)
      throw new AppError('VALIDATION_ERROR', `Range is limited to ${MAX_RANGE_DAYS} days`);
    if (q.granularity === 'hour' && r!.days > MAX_HOURLY_DAYS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Hourly granularity is limited to ${MAX_HOURLY_DAYS} days`,
      );
    }
    return {
      tz,
      from,
      to,
      start,
      end,
      days: r!.days,
      utcFrom: start.slice(0, 10),
      utcTo: new Date(Date.parse(end) - 1).toISOString().slice(0, 10),
      includeBots: q.includeBots ?? !ws.filterBots,
      unit: q.granularity,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Postgres rejected the timezone name (Intl accepted something PG does not know).
    throw new AppError('VALIDATION_ERROR', 'Unsupported timezone');
  }
}

const botCond = (r: Resolved, col = '"isBot"') =>
  r.includeBots ? Prisma.empty : Prisma.sql`AND NOT ${Prisma.raw(col)}`;
const scopeCond = (s: Scope) =>
  Prisma.sql`"workspaceId" = ${s.workspaceId} ${s.linkId ? Prisma.sql`AND "linkId" = ${s.linkId}` : Prisma.empty} ${s.campaignId ? Prisma.sql`AND "campaignId" = ${s.campaignId}` : Prisma.empty}`;

/** Series of local timestamps so days/hours with no clicks still appear as zeros. */
const series = (r: Resolved) =>
  r.unit === 'day'
    ? Prisma.sql`generate_series(${r.from}::timestamp, ${r.to}::timestamp, interval '1 day')`
    : Prisma.sql`generate_series(${r.from}::timestamp, ${r.to}::timestamp + interval '23 hours', interval '1 hour')`;
const labelFmt = (r: Resolved) => (r.unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DD"T"HH24:00');

function shape(
  r: Resolved,
  summary: Row,
  timeline: Row[],
  dims: Record<string, Row[]>,
  topLinks: Row[],
  source: 'rollup' | 'events',
) {
  const human = num(summary.human);
  const bot = num(summary.bot);
  const notes: string[] = [
    'Unique visitors are approximate (hash of day-salted IP and user agent) and, over several days, are the sum of daily uniques.',
    'Bot detection and GeoIP are heuristic/approximate.',
  ];
  if (source === 'rollup' && r.tz !== 'UTC') {
    notes.push(
      'Timeline and click totals use exact local-time buckets; unique visitors and breakdowns are aggregated by UTC day, so they can differ slightly at the edges of the range.',
    );
  }
  return {
    summary: {
      clicks: r.includeBots ? human + bot : human,
      humanClicks: human,
      botClicks: bot,
      uniqueVisitors: num(summary.uniques),
      qrScans: num(summary.qr),
    },
    timeline,
    ...Object.fromEntries(Object.values(DIM_KEYS).map((k) => [k, dims[k] ?? []])),
    topLinks,
    meta: {
      timezone: r.tz,
      from: r.from,
      to: r.to,
      granularity: r.unit,
      includeBots: r.includeBots,
      source,
      notes,
    },
  };
}

/** Rollup path: reads only the small aggregated tables. */
async function fromRollups(ctx: AppContext, s: Scope, r: Resolved, limit: number) {
  const { prisma } = ctx;
  const [clicks] = await prisma.$queryRaw<Row[]>`
    SELECT COALESCE(SUM(clicks) FILTER (WHERE NOT "isBot"), 0) AS human, COALESCE(SUM(clicks) FILTER (WHERE "isBot"), 0) AS bot
    FROM "AnalyticsBucket" WHERE ${scopeCond(s)} AND "bucket" >= ${r.start}::timestamp AND "bucket" < ${r.end}::timestamp`;
  const [uniq] = await prisma.$queryRaw<Row[]>`
    SELECT COALESCE(SUM("uniqueVisitors"), 0) AS uniques FROM "AnalyticsDaily"
    WHERE ${scopeCond(s)} AND "date" BETWEEN ${r.utcFrom}::date AND ${r.utcTo}::date ${botCond(r)}`;
  const timeline = await prisma.$queryRaw<Row[]>`
    SELECT to_char(s.ts, ${labelFmt(r)}) AS date,
           COALESCE(a.human, 0)::int AS "humanClicks", COALESCE(a.bot, 0)::int AS "botClicks"
    FROM ${series(r)} AS s(ts)
    LEFT JOIN (
      SELECT date_trunc(${r.unit}, ("bucket" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}) AS ts,
             SUM(clicks) FILTER (WHERE NOT "isBot") AS human, SUM(clicks) FILTER (WHERE "isBot") AS bot
      FROM "AnalyticsBucket" WHERE ${scopeCond(s)} AND "bucket" >= ${r.start}::timestamp AND "bucket" < ${r.end}::timestamp
      GROUP BY 1
    ) a ON a.ts = s.ts
    ORDER BY s.ts`;
  const dimRows = await prisma.$queryRaw<Row[]>`
    SELECT dimension::text AS dimension, value, clicks::int AS clicks FROM (
      SELECT dimension, value, SUM(clicks) AS clicks,
             row_number() OVER (PARTITION BY dimension ORDER BY SUM(clicks) DESC, value) AS rn
      FROM "AnalyticsDimensionDaily"
      WHERE ${scopeCond(s)} AND "date" BETWEEN ${r.utcFrom}::date AND ${r.utcTo}::date ${botCond(r)}
      GROUP BY dimension, value
    ) t WHERE rn <= ${limit} ORDER BY dimension, clicks DESC, value`;
  const [qr] = await prisma.$queryRaw<Row[]>`
    SELECT COALESCE(SUM(clicks), 0) AS qr FROM "AnalyticsDimensionDaily"
    WHERE ${scopeCond(s)} AND dimension = 'QR_CODE'::"Dimension" AND "date" BETWEEN ${r.utcFrom}::date AND ${r.utcTo}::date ${botCond(r)}`;
  let topLinks: Row[] = [];
  if (!s.linkId) {
    const top = await prisma.$queryRaw<{ linkId: string; clicks: number }[]>`
      SELECT "linkId", SUM(clicks)::int AS clicks FROM "AnalyticsDaily"
      WHERE ${scopeCond(s)} AND "date" BETWEEN ${r.utcFrom}::date AND ${r.utcTo}::date ${botCond(r)}
      GROUP BY "linkId" ORDER BY clicks DESC, "linkId" LIMIT ${limit}`;
    topLinks = await labelLinks(ctx, s.workspaceId, top);
  }
  return shape(
    r,
    { ...clicks, ...uniq, ...qr },
    timeline.map((t) => ({
      date: t.date,
      clicks: r.includeBots ? num(t.humanClicks) + num(t.botClicks) : num(t.humanClicks),
      humanClicks: num(t.humanClicks),
      botClicks: num(t.botClicks),
    })),
    await groupDims(ctx, s.workspaceId, dimRows),
    topLinks,
    'rollup',
  );
}

/** Event path: used only when filtering by country/device, which rollups cannot cross-filter. Bounded to 31 days. */
async function fromEvents(
  ctx: AppContext,
  s: Scope,
  q: AnalyticsQuery,
  r: Resolved,
  limit: number,
) {
  if (r.days > MAX_EVENT_FILTER_DAYS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Country/device filters are limited to ${MAX_EVENT_FILTER_DAYS} days`,
    );
  }
  const { prisma } = ctx;
  const where = Prisma.sql`${scopeCond(s)} AND "timestamp" >= ${r.start}::timestamp AND "timestamp" < ${r.end}::timestamp
    ${q.country ? Prisma.sql`AND "country" = ${q.country}` : Prisma.empty}
    ${q.device ? Prisma.sql`AND "device" = ${q.device}::"DeviceType"` : Prisma.empty} ${botCond(r)}`;
  const [sum] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*) FILTER (WHERE NOT "isBot") AS human, COUNT(*) FILTER (WHERE "isBot") AS bot,
           COUNT(DISTINCT "visitorHash") AS uniques, COUNT(*) FILTER (WHERE "qrCodeId" IS NOT NULL) AS qr
    FROM "ClickEvent" WHERE ${where}`;
  const timeline = await prisma.$queryRaw<Row[]>`
    SELECT to_char(s.ts, ${labelFmt(r)}) AS date, COALESCE(a.human, 0)::int AS "humanClicks", COALESCE(a.bot, 0)::int AS "botClicks"
    FROM ${series(r)} AS s(ts)
    LEFT JOIN (
      SELECT date_trunc(${r.unit}, ("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}) AS ts,
             COUNT(*) FILTER (WHERE NOT "isBot") AS human, COUNT(*) FILTER (WHERE "isBot") AS bot
      FROM "ClickEvent" WHERE ${where} GROUP BY 1
    ) a ON a.ts = s.ts ORDER BY s.ts`;
  const dim = (name: string, expr: Prisma.Sql) => prisma.$queryRaw<Row[]>`
    SELECT ${name}::text AS dimension, ${expr} AS value, COUNT(*)::int AS clicks FROM "ClickEvent"
    WHERE ${where} AND ${expr} IS NOT NULL GROUP BY 2 ORDER BY clicks DESC, 2 LIMIT ${limit}`;
  const dimRows = (
    await Promise.all([
      dim('COUNTRY', Prisma.sql`"country"`),
      dim(
        'REGION',
        Prisma.sql`CASE WHEN "region" IS NULL THEN NULL ELSE "region" || COALESCE(', ' || "country", '') END`,
      ),
      dim(
        'CITY',
        Prisma.sql`CASE WHEN "city" IS NULL THEN NULL ELSE "city" || COALESCE(', ' || "country", '') END`,
      ),
      dim('DEVICE', Prisma.sql`"device"::text`),
      dim('BROWSER', Prisma.sql`COALESCE("browser", 'Unknown')`),
      dim('OS', Prisma.sql`COALESCE("os", 'Unknown')`),
      dim('REFERRER', Prisma.sql`COALESCE("referrer", '(direct)')`),
      dim('UTM_SOURCE', Prisma.sql`"utmSource"`),
      dim('UTM_MEDIUM', Prisma.sql`"utmMedium"`),
      dim('UTM_CAMPAIGN', Prisma.sql`"utmCampaign"`),
      dim('QR_CODE', Prisma.sql`"qrCodeId"`),
    ])
  ).flat();
  let topLinks: Row[] = [];
  if (!s.linkId) {
    const top = await prisma.$queryRaw<{ linkId: string; clicks: number }[]>`
      SELECT "linkId", COUNT(*)::int AS clicks FROM "ClickEvent" WHERE ${where} GROUP BY "linkId" ORDER BY clicks DESC, "linkId" LIMIT ${limit}`;
    topLinks = await labelLinks(ctx, s.workspaceId, top);
  }
  return shape(
    r,
    sum!,
    timeline.map((t) => ({
      date: t.date,
      clicks: r.includeBots ? num(t.humanClicks) + num(t.botClicks) : num(t.humanClicks),
      humanClicks: num(t.humanClicks),
      botClicks: num(t.botClicks),
    })),
    await groupDims(ctx, s.workspaceId, dimRows),
    topLinks,
    'events',
  );
}

async function labelLinks(
  ctx: AppContext,
  workspaceId: string,
  top: { linkId: string; clicks: number }[],
) {
  if (top.length === 0) return [];
  // Scoped by workspace: a link id can never be labelled across tenants.
  const links = await ctx.prisma.link.findMany({
    where: { workspaceId, id: { in: top.map((t) => t.linkId) } },
    select: { id: true, slug: true, title: true, domain: { select: { hostname: true } } },
  });
  const byId = new Map(links.map((l) => [l.id, l]));
  return top.map((t) => {
    const l = byId.get(t.linkId);
    return {
      linkId: t.linkId,
      clicks: num(t.clicks),
      slug: l?.slug ?? null,
      title: l?.title ?? null,
      hostname: l?.domain.hostname ?? null,
      deleted: !l,
    };
  });
}

async function groupDims(ctx: AppContext, workspaceId: string, rows: Row[]) {
  const out: Record<string, Row[]> = {};
  for (const r of rows)
    (out[DIM_KEYS[String(r.dimension)]!] ??= []).push({ value: r.value, clicks: num(r.clicks) });
  if (out.qrCodes?.length) {
    const names = await ctx.prisma.qRCode.findMany({
      where: { workspaceId, id: { in: out.qrCodes.map((q) => String(q.value)) } },
      select: { id: true, name: true },
    });
    const byId = new Map(names.map((n) => [n.id, n.name]));
    out.qrCodes = out.qrCodes.map((q) => ({ ...q, name: byId.get(String(q.value)) ?? null }));
  }
  return out;
}

export async function queryAnalytics(
  ctx: AppContext,
  scope: Scope,
  q: AnalyticsQuery,
  ws: WorkspaceSettings,
) {
  const r = await resolveRange(ctx, q, ws);
  return q.country || q.device
    ? fromEvents(ctx, scope, q, r, q.limit)
    : fromRollups(ctx, scope, r, q.limit);
}

export { resolveRange };
export type { Resolved };
