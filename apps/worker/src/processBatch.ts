import { Prisma, type PrismaClient } from '@go-short/database';
import type { AnalyticsEvent } from '@go-short/shared';
import type { Logger } from 'pino';
import {
  Hasher,
  parseUserAgent,
  primaryLanguage,
  referrerHost,
  utcDay,
  type Device,
  type ParsedUa,
} from './enrich';
import type { GeoLookup } from './geo';

export interface WorkerDeps {
  prisma: PrismaClient;
  logger: Logger;
  geo: GeoLookup;
  hasher: Hasher;
  now?: () => number;
}

export interface BatchResult {
  received: number;
  invalid: number;
  duplicates: number;
  inserted: number;
}

/** Referrer/city/region values are visitor- or network-controlled, so per (link, day) distinct values are capped. */
export const DIMENSION_VALUE_CAP = 100;
export const OTHER = 'other';
const CAPPED = ['REFERRER', 'REGION', 'CITY'] as const;

type Dimension =
  | 'COUNTRY'
  | 'REGION'
  | 'CITY'
  | 'DEVICE'
  | 'BROWSER'
  | 'OS'
  | 'REFERRER'
  | 'UTM_SOURCE'
  | 'UTM_MEDIUM'
  | 'UTM_CAMPAIGN';

interface LinkMeta {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

interface Row {
  id: string;
  workspaceId: string;
  linkId: string;
  campaignId: string | null;
  timestamp: string; // ISO
  day: string; // YYYY-MM-DD (UTC)
  visitorHash: string;
  ipHash: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: Device;
  browser: string | null;
  browserVer: string | null;
  os: string | null;
  osVer: string | null;
  isBot: boolean;
  referrer: string | null;
  language: string | null;
  utm: LinkMeta;
}

const MIN_TS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_MS = 24 * 3600 * 1000;
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/** Defensive: the queue is an input boundary. Anything malformed is dropped, never allowed to fail the batch. */
function validEvent(e: unknown, now: number): e is AnalyticsEvent {
  if (typeof e !== 'object' || e === null) return false;
  const v = e as Record<string, unknown>;
  return (
    str(v.eventId, 64) &&
    str(v.linkId, 64) &&
    str(v.workspaceId, 64) &&
    (v.campaignId === null || str(v.campaignId, 64)) &&
    typeof v.timestamp === 'number' &&
    Number.isFinite(v.timestamp) &&
    v.timestamp >= MIN_TS &&
    v.timestamp <= now + MAX_FUTURE_MS &&
    str(v.ip, 64) &&
    (v.userAgent === null || typeof v.userAgent === 'string') &&
    (v.referer === null || typeof v.referer === 'string') &&
    (v.acceptLanguage === null || typeof v.acceptLanguage === 'string')
  );
}

/** Small bounded TTL cache for rarely-changing lookups (link UTM config, workspace privacy flags). */
class TtlCache<V> {
  private readonly m = new Map<string, { v: V; until: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}
  get(k: string, now: number): V | undefined {
    const e = this.m.get(k);
    return e && e.until > now ? e.v : undefined;
  }
  set(k: string, v: V, now: number): void {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    this.m.set(k, { v, until: now + this.ttlMs });
  }
}

export class BatchProcessor {
  private readonly links = new TtlCache<LinkMeta>(60_000, 20_000);
  private readonly hashIps = new TtlCache<boolean>(60_000, 5_000);
  private readonly uaCache = new Map<string, ParsedUa>();

  constructor(private readonly deps: WorkerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private parseUa(ua: string | null): ParsedUa {
    const key = ua ?? '';
    let p = this.uaCache.get(key);
    if (!p) {
      p = parseUserAgent(ua);
      if (this.uaCache.size >= 5000)
        this.uaCache.delete(this.uaCache.keys().next().value as string);
      this.uaCache.set(key, p);
    }
    return p;
  }

  private async loadMeta(events: AnalyticsEvent[]): Promise<void> {
    const t = this.now();
    const needLinks = [...new Set(events.map((e) => e.linkId))].filter(
      (id) => !this.links.get(id, t),
    );
    if (needLinks.length) {
      const rows = await this.deps.prisma.link.findMany({
        where: { id: { in: needLinks } },
        select: { id: true, utmSource: true, utmMedium: true, utmCampaign: true },
      });
      const found = new Map(rows.map((r) => [r.id, r]));
      // Deleted links still get their clicks recorded, just without UTM attribution.
      for (const id of needLinks) {
        const r = found.get(id);
        this.links.set(
          id,
          {
            utmSource: r?.utmSource ?? null,
            utmMedium: r?.utmMedium ?? null,
            utmCampaign: r?.utmCampaign ?? null,
          },
          t,
        );
      }
    }
    const needWs = [...new Set(events.map((e) => e.workspaceId))].filter(
      (id) => this.hashIps.get(id, t) === undefined,
    );
    if (needWs.length) {
      const rows = await this.deps.prisma.workspace.findMany({
        where: { id: { in: needWs } },
        select: { id: true, hashIps: true },
      });
      const found = new Map(rows.map((r) => [r.id, r.hashIps]));
      for (const id of needWs) this.hashIps.set(id, found.get(id) ?? true, t);
    }
  }

  private enrich(e: AnalyticsEvent): Row {
    const t = this.now();
    const day = utcDay(e.timestamp);
    const ua = this.parseUa(e.userAgent);
    const geo = this.deps.geo.lookup(e.ip);
    return {
      id: e.eventId,
      workspaceId: e.workspaceId,
      linkId: e.linkId,
      campaignId: e.campaignId,
      timestamp: new Date(e.timestamp).toISOString(),
      day,
      visitorHash: this.deps.hasher.visitorHash(day, e.ip, e.userAgent),
      // Raw IPs are never persisted; the hash is only stored when the workspace keeps IP hashing on.
      ipHash:
        this.hashIps.get(e.workspaceId, t) === false ? null : this.deps.hasher.ipHash(day, e.ip),
      country: geo.country,
      region: geo.region,
      city: geo.city,
      device: ua.device,
      browser: ua.browser,
      browserVer: ua.browserVersion,
      os: ua.os,
      osVer: ua.osVersion,
      isBot: ua.isBot,
      referrer: referrerHost(e.referer),
      language: primaryLanguage(e.acceptLanguage),
      utm: this.links.get(e.linkId, t) ?? { utmSource: null, utmMedium: null, utmCampaign: null },
    };
  }

  async process(input: unknown[]): Promise<BatchResult> {
    const now = this.now();
    const events = input.filter((e): e is AnalyticsEvent => validEvent(e, now));
    const invalid = input.length - events.length;
    if (events.length === 0) return { received: input.length, invalid, duplicates: 0, inserted: 0 };
    if (invalid) this.deps.logger.warn({ invalid }, 'dropped malformed analytics events');

    await this.loadMeta(events);
    const rows = events.map((e) => this.enrich(e));

    const inserted = await this.deps.prisma.$transaction(
      async (tx) => {
        // 1. Raw events. ON CONFLICT DO NOTHING + RETURNING tells us which are genuinely new, so a
        //    redelivered batch (retry, duplicate job) is never counted twice.
        const ids = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "ClickEvent" ("id","workspaceId","linkId","campaignId","timestamp","visitorHash","ipHash",
          "country","region","city","device","browser","browserVer","os","osVer","isBot","referrer","language",
          "utmSource","utmMedium","utmCampaign")
        SELECT * FROM unnest(
          ${rows.map((r) => r.id)}::text[], ${rows.map((r) => r.workspaceId)}::text[], ${rows.map((r) => r.linkId)}::text[],
          ${rows.map((r) => r.campaignId)}::text[], ${rows.map((r) => r.timestamp)}::timestamp[],
          ${rows.map((r) => r.visitorHash)}::text[], ${rows.map((r) => r.ipHash)}::text[],
          ${rows.map((r) => r.country)}::text[], ${rows.map((r) => r.region)}::text[], ${rows.map((r) => r.city)}::text[],
          ${rows.map((r) => r.device)}::"DeviceType"[], ${rows.map((r) => r.browser)}::text[], ${rows.map((r) => r.browserVer)}::text[],
          ${rows.map((r) => r.os)}::text[], ${rows.map((r) => r.osVer)}::text[], ${rows.map((r) => r.isBot)}::boolean[],
          ${rows.map((r) => r.referrer)}::text[], ${rows.map((r) => r.language)}::text[],
          ${rows.map((r) => r.utm.utmSource)}::text[], ${rows.map((r) => r.utm.utmMedium)}::text[], ${rows.map((r) => r.utm.utmCampaign)}::text[]
        )
        ON CONFLICT ("id") DO NOTHING
        RETURNING "id"`;
        const fresh = new Set(ids.map((r) => r.id));
        const news = rows.filter((r) => fresh.has(r.id));
        if (news.length === 0) return 0;

        await this.aggregate(tx, news);
        return news.length;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    return { received: input.length, invalid, duplicates: events.length - inserted, inserted };
  }

  private async aggregate(tx: Prisma.TransactionClient, news: Row[]): Promise<void> {
    // Unique visitors: a visitor is "new" for (day, link) only if its DailyVisitor row did not exist.
    const visitorKeys = new Map<string, { day: string; linkId: string; hash: string }>();
    const botOf = new Map<string, boolean>();
    for (const r of news) {
      const k = `${r.day}|${r.linkId}|${r.visitorHash}`;
      visitorKeys.set(k, { day: r.day, linkId: r.linkId, hash: r.visitorHash });
      botOf.set(k, r.isBot);
    }
    const vs = [...visitorKeys.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const newVisitors = await tx.$queryRaw<{ date: Date; linkId: string; visitorHash: string }[]>`
      INSERT INTO "DailyVisitor" ("date","linkId","visitorHash")
      SELECT * FROM unnest(${vs.map(([, v]) => v.day)}::date[], ${vs.map(([, v]) => v.linkId)}::text[], ${vs.map(([, v]) => v.hash)}::text[])
      ON CONFLICT DO NOTHING
      RETURNING "date","linkId","visitorHash"`;

    // Daily totals per (day, link, isBot).
    interface Daily {
      day: string;
      workspaceId: string;
      linkId: string;
      campaignId: string | null;
      isBot: boolean;
      clicks: number;
      uniques: number;
      mobile: number;
      desktop: number;
      tablet: number;
    }
    const daily = new Map<string, Daily>();
    for (const r of news) {
      const k = `${r.day}|${r.linkId}|${r.isBot}`;
      let d = daily.get(k);
      if (!d)
        daily.set(
          k,
          (d = {
            day: r.day,
            workspaceId: r.workspaceId,
            linkId: r.linkId,
            campaignId: r.campaignId,
            isBot: r.isBot,
            clicks: 0,
            uniques: 0,
            mobile: 0,
            desktop: 0,
            tablet: 0,
          }),
        );
      d.clicks++;
      if (r.device === 'MOBILE') d.mobile++;
      else if (r.device === 'DESKTOP') d.desktop++;
      else if (r.device === 'TABLET') d.tablet++;
    }
    for (const v of newVisitors) {
      const day = v.date.toISOString().slice(0, 10);
      const isBot = botOf.get(`${day}|${v.linkId}|${v.visitorHash}`) ?? false;
      const d = daily.get(`${day}|${v.linkId}|${isBot}`);
      if (d) d.uniques++;
    }
    const ds = [...daily.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, d]) => d);
    await tx.$executeRaw`
      INSERT INTO "AnalyticsDaily" ("date","workspaceId","linkId","campaignId","isBot","clicks","uniqueVisitors","mobileClicks","desktopClicks","tabletClicks")
      SELECT * FROM unnest(${ds.map((d) => d.day)}::date[], ${ds.map((d) => d.workspaceId)}::text[], ${ds.map((d) => d.linkId)}::text[],
        ${ds.map((d) => d.campaignId)}::text[], ${ds.map((d) => d.isBot)}::boolean[], ${ds.map((d) => d.clicks)}::int[],
        ${ds.map((d) => d.uniques)}::int[], ${ds.map((d) => d.mobile)}::int[], ${ds.map((d) => d.desktop)}::int[], ${ds.map((d) => d.tablet)}::int[])
      ON CONFLICT ("date","linkId","isBot") DO UPDATE SET
        "clicks" = "AnalyticsDaily"."clicks" + EXCLUDED."clicks",
        "uniqueVisitors" = "AnalyticsDaily"."uniqueVisitors" + EXCLUDED."uniqueVisitors",
        "mobileClicks" = "AnalyticsDaily"."mobileClicks" + EXCLUDED."mobileClicks",
        "desktopClicks" = "AnalyticsDaily"."desktopClicks" + EXCLUDED."desktopClicks",
        "tabletClicks" = "AnalyticsDaily"."tabletClicks" + EXCLUDED."tabletClicks",
        "campaignId" = EXCLUDED."campaignId"`;

    await this.aggregateDimensions(tx, news);
  }

  private async aggregateDimensions(tx: Prisma.TransactionClient, news: Row[]): Promise<void> {
    interface Cand {
      day: string;
      linkId: string;
      dim: Dimension;
      value: string;
      isBot: boolean;
      workspaceId: string;
      campaignId: string | null;
    }
    const cands: Cand[] = [];
    for (const r of news) {
      const add = (dim: Dimension, value: string | null) => {
        if (value)
          cands.push({
            day: r.day,
            linkId: r.linkId,
            dim,
            value,
            isBot: r.isBot,
            workspaceId: r.workspaceId,
            campaignId: r.campaignId,
          });
      };
      add('COUNTRY', r.country);
      add('REGION', r.region ? `${r.region}${r.country ? `, ${r.country}` : ''}` : null);
      add('CITY', r.city ? `${r.city}${r.country ? `, ${r.country}` : ''}` : null);
      add('DEVICE', r.device);
      add('BROWSER', r.browser ?? 'Unknown');
      add('OS', r.os ?? 'Unknown');
      add('REFERRER', r.referrer ?? '(direct)');
      add('UTM_SOURCE', r.utm.utmSource);
      add('UTM_MEDIUM', r.utm.utmMedium);
      add('UTM_CAMPAIGN', r.utm.utmCampaign);
    }

    // Cardinality cap for the unbounded dimensions: load what already exists for the touched
    // (day, link) pairs, then fold values beyond the cap into "other".
    const pairs = [
      ...new Set(
        cands
          .filter((c) => (CAPPED as readonly string[]).includes(c.dim))
          .map((c) => `${c.day}|${c.linkId}`),
      ),
    ];
    const existing = new Map<string, Set<string>>();
    if (pairs.length) {
      const rows = await tx.$queryRaw<
        { date: Date; linkId: string; dimension: string; value: string }[]
      >`
        SELECT DISTINCT "date","linkId","dimension"::text AS "dimension","value" FROM "AnalyticsDimensionDaily"
        WHERE ("date","linkId") IN (SELECT * FROM unnest(${pairs.map((p) => p.split('|')[0]!)}::date[], ${pairs.map((p) => p.split('|')[1]!)}::text[]))
          AND "dimension" IN ('REFERRER'::"Dimension",'REGION'::"Dimension",'CITY'::"Dimension")`;
      for (const r of rows) {
        const k = `${r.date.toISOString().slice(0, 10)}|${r.linkId}|${r.dimension}`;
        (existing.get(k) ?? existing.set(k, new Set()).get(k)!).add(r.value);
      }
    }
    for (const c of cands) {
      if (!(CAPPED as readonly string[]).includes(c.dim)) continue;
      const k = `${c.day}|${c.linkId}|${c.dim}`;
      const set = existing.get(k) ?? existing.set(k, new Set()).get(k)!;
      if (set.has(c.value)) continue;
      if (set.size < DIMENSION_VALUE_CAP) set.add(c.value);
      else c.value = OTHER;
    }

    const agg = new Map<string, Cand & { clicks: number }>();
    for (const c of cands) {
      const k = `${c.day}|${c.linkId}|${c.dim}|${c.value}|${c.isBot}`;
      const a = agg.get(k);
      if (a) a.clicks++;
      else agg.set(k, { ...c, clicks: 1 });
    }
    const out = [...agg.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
    if (out.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO "AnalyticsDimensionDaily" ("date","linkId","dimension","value","isBot","workspaceId","campaignId","clicks")
      SELECT * FROM unnest(${out.map((o) => o.day)}::date[], ${out.map((o) => o.linkId)}::text[], ${out.map((o) => o.dim)}::"Dimension"[],
        ${out.map((o) => o.value)}::text[], ${out.map((o) => o.isBot)}::boolean[], ${out.map((o) => o.workspaceId)}::text[],
        ${out.map((o) => o.campaignId)}::text[], ${out.map((o) => o.clicks)}::int[])
      ON CONFLICT ("date","linkId","dimension","value","isBot") DO UPDATE SET
        "clicks" = "AnalyticsDimensionDaily"."clicks" + EXCLUDED."clicks"`;
  }
}
