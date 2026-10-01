import { getPrisma } from '@go-short/database';
import type { AnalyticsEvent } from '@go-short/shared';
import { pino } from 'pino';
import { Hasher } from '../src/enrich';
import type { GeoLookup } from '../src/geo';
import { BatchProcessor } from '../src/processBatch';

export const prisma = getPrisma();

/** 1.x.x.x => Mumbai/IN, 2.x.x.x => Berlin/DE, anything else unknown. */
export const fakeGeo: GeoLookup = {
  lookup: (ip) =>
    ip.startsWith('1.')
      ? { country: 'IN', region: 'Maharashtra', city: 'Mumbai' }
      : ip.startsWith('2.')
        ? { country: 'DE', region: 'Berlin', city: 'Berlin' }
        : { country: null, region: null, city: null },
};

export const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
export const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
export const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export function makeProcessor(over: { now?: () => number } = {}) {
  return new BatchProcessor({
    prisma,
    logger: pino({ level: 'silent' }),
    geo: fakeGeo,
    hasher: new Hasher('test-secret-test-secret-test-secret-1'),
    now: over.now,
  });
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User","Workspace","Domain","ClickEvent","AnalyticsDaily","AnalyticsDimensionDaily","DailyVisitor" CASCADE',
  );
}

export async function seed(link: Record<string, unknown> = {}, ws: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { email: `u${Math.random()}@example.com`, name: 'u', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'W',
      slug: `w-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: { userId: user.id, role: 'OWNER' } },
      ...ws,
    },
  });
  const domain = await prisma.domain.create({
    data: {
      hostname: `d${Math.random().toString(36).slice(2, 8)}.example.com`,
      workspaceId: workspace.id,
      status: 'VERIFIED',
      isVerified: true,
      verificationToken: 't',
    },
  });
  const campaign = await prisma.campaign.create({
    data: { workspaceId: workspace.id, name: 'Camp' },
  });
  const l = await prisma.link.create({
    data: {
      workspaceId: workspace.id,
      domainId: domain.id,
      slug: 'abc',
      destinationUrl: 'https://example.org',
      campaignId: campaign.id,
      ...link,
    },
  });
  return { workspace, domain, campaign, link: l };
}

let n = 0;
export function ev(
  linkId: string,
  workspaceId: string,
  over: Partial<AnalyticsEvent> = {},
): AnalyticsEvent {
  return {
    eventId: `evt-${Date.now()}-${n++}`,
    linkId,
    workspaceId,
    campaignId: null,
    timestamp: Date.now(),
    ip: '1.2.3.4',
    userAgent: CHROME,
    referer: null,
    acceptLanguage: 'en-IN,en;q=0.9',
    forwardedFor: null,
    ...over,
  };
}
