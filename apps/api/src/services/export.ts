import { once } from 'node:events';
import type { Response } from 'express';
import { Prisma } from '@go-short/database';
import { AppError } from '@go-short/shared';
import type { AppContext } from '../context';
import type { Resolved, Scope } from './analytics';

export const EXPORT_MAX_ROWS = 1_000_000;
const BATCH = 5000;

/**
 * CSV cell. Values that start with = + - @ (or tab/CR) are prefixed with an apostrophe so spreadsheets
 * do not execute them as formulas (referrers and UTM values are visitor- or user-influenced).
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';

async function write(res: Response, chunk: string): Promise<void> {
  // Honour backpressure so a slow client cannot make us buffer the whole export in memory.
  if (!res.write(chunk)) await once(res, 'drain');
}

const scopeCond = (s: Scope, alias: string) =>
  Prisma.sql`${Prisma.raw(alias)}."workspaceId" = ${s.workspaceId} ${s.linkId ? Prisma.sql`AND ${Prisma.raw(alias)}."linkId" = ${s.linkId}` : Prisma.empty} ${s.campaignId ? Prisma.sql`AND ${Prisma.raw(alias)}."campaignId" = ${s.campaignId}` : Prisma.empty}`;

function begin(res: Response, filename: string): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
}

export async function streamDailyCsv(
  ctx: AppContext,
  res: Response,
  s: Scope,
  r: Resolved,
): Promise<void> {
  begin(res, `analytics-daily-${r.from}_${r.to}.csv`);
  await write(
    res,
    line([
      'date_utc',
      'link_id',
      'hostname',
      'slug',
      'is_bot',
      'clicks',
      'unique_visitors',
      'mobile_clicks',
      'desktop_clicks',
      'tablet_clicks',
    ]),
  );
  let after: { date: string; linkId: string; isBot: boolean } | null = null;
  for (;;) {
    const keyset = after
      ? Prisma.sql`AND (d."date", d."linkId", d."isBot") > (${after.date}::date, ${after.linkId}, ${after.isBot})`
      : Prisma.empty;
    const rows: Record<string, unknown>[] = await ctx.prisma.$queryRaw`
      SELECT to_char(d."date", 'YYYY-MM-DD') AS date, d."linkId", dom."hostname", l."slug", d."isBot", d."clicks", d."uniqueVisitors",
             d."mobileClicks", d."desktopClicks", d."tabletClicks"
      FROM "AnalyticsDaily" d LEFT JOIN "Link" l ON l."id" = d."linkId" AND l."workspaceId" = d."workspaceId"
      LEFT JOIN "Domain" dom ON dom."id" = l."domainId"
      WHERE ${scopeCond(s, 'd')} AND d."date" BETWEEN ${r.utcFrom}::date AND ${r.utcTo}::date
        ${r.includeBots ? Prisma.empty : Prisma.sql`AND NOT d."isBot"`} ${keyset}
      ORDER BY d."date", d."linkId", d."isBot" LIMIT ${BATCH}`;
    for (const x of rows)
      await write(
        res,
        line([
          x.date,
          x.linkId,
          x.hostname,
          x.slug,
          x.isBot,
          x.clicks,
          x.uniqueVisitors,
          x.mobileClicks,
          x.desktopClicks,
          x.tabletClicks,
        ]),
      );
    if (rows.length < BATCH) break;
    const last = rows[rows.length - 1]!;
    after = { date: String(last.date), linkId: String(last.linkId), isBot: Boolean(last.isBot) };
  }
  res.end();
}

/** Raw clicks, streamed in keyset batches. Deliberately excludes IP/visitor hashes. */
export async function streamEventsCsv(
  ctx: AppContext,
  res: Response,
  s: Scope,
  r: Resolved,
): Promise<void> {
  const base = Prisma.sql`${scopeCond(s, 'e')} AND e."timestamp" >= ${r.start}::timestamp AND e."timestamp" < ${r.end}::timestamp ${r.includeBots ? Prisma.empty : Prisma.sql`AND NOT e."isBot"`}`;
  const [counted] = await ctx.prisma.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*) AS n FROM (SELECT 1 FROM "ClickEvent" e WHERE ${base} LIMIT ${EXPORT_MAX_ROWS + 1}) t`;
  if (Number(counted?.n ?? 0) > EXPORT_MAX_ROWS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Export is limited to ${EXPORT_MAX_ROWS.toLocaleString('en-US')} rows; narrow the date range or filter by link`,
    );
  }
  begin(res, `analytics-events-${r.from}_${r.to}.csv`);
  await write(
    res,
    line([
      'timestamp_utc',
      'link_id',
      'campaign_id',
      'qr_code_id',
      'country',
      'region',
      'city',
      'device',
      'browser',
      'os',
      'is_bot',
      'referrer',
      'language',
      'utm_source',
      'utm_medium',
      'utm_campaign',
    ]),
  );
  let after: { ts: string; id: string } | null = null;
  for (;;) {
    const keyset = after
      ? Prisma.sql`AND (e."timestamp", e."id") > (${after.ts}::timestamp, ${after.id})`
      : Prisma.empty;
    const rows: Record<string, unknown>[] = await ctx.prisma.$queryRaw`
      SELECT e."id", to_char(e."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts, e."linkId", e."campaignId", e."qrCodeId", e."country", e."region", e."city",
             e."device"::text AS device, e."browser", e."os", e."isBot", e."referrer", e."language", e."utmSource", e."utmMedium", e."utmCampaign"
      FROM "ClickEvent" e WHERE ${base} ${keyset} ORDER BY e."timestamp", e."id" LIMIT ${BATCH}`;
    for (const x of rows)
      await write(
        res,
        line([
          x.ts,
          x.linkId,
          x.campaignId,
          x.qrCodeId,
          x.country,
          x.region,
          x.city,
          x.device,
          x.browser,
          x.os,
          x.isBot,
          x.referrer,
          x.language,
          x.utmSource,
          x.utmMedium,
          x.utmCampaign,
        ]),
      );
    if (rows.length < BATCH) break;
    const last = rows[rows.length - 1]!;
    after = { ts: String(last.ts).replace('Z', ''), id: String(last.id) };
  }
  res.end();
}
