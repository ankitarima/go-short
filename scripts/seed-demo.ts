/**
 * Demo data for local development and screenshots. Creates a user, a workspace, a campaign, links, QR
 * codes and an API key through the REAL API, then ingests ~30 days of synthetic clicks through the REAL
 * analytics processor (UA parsing, GeoIP, rollups).
 *
 *   npm run dev:infra && (start the API) && npx tsx --env-file=.env scripts/seed-demo.ts
 *
 * Login afterwards with demo@example.com / demo-password-123.
 */
import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import type { AnalyticsEvent } from '@go-short/shared';
import { pino } from 'pino';
import { Hasher } from '../apps/worker/src/enrich';
import { loadGeo } from '../apps/worker/src/geo';
import { BatchProcessor } from '../apps/worker/src/processBatch';

const API = process.env.SEED_API ?? 'http://localhost:4000/api/v1';
const EMAIL = 'demo@example.com';
const PASSWORD = 'demo-password-123';
const config = loadConfig();

let cookie = '';
let csrf = '';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const json = (await res.json()) as { data: T; error?: { message: string } };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.message}`);
  return json.data;
}

async function login() {
  for (const path of ['/auth/login', '/auth/register']) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, name: 'Demo User', password: PASSWORD }),
    });
    if (res.ok) {
      cookie = res.headers.get('set-cookie')!.split(';')[0]!;
      csrf = ((await res.json()) as { data: { csrfToken: string } }).data.csrfToken;
      return;
    }
  }
  throw new Error('Could not sign in or register the demo user');
}

await login();
const workspaces = await call<Array<{ id: string; name: string }>>('GET', '/workspaces');
let ws = workspaces.find((w) => w.name === 'Acme Marketing');
ws ??= await call<{ id: string; name: string }>('POST', '/workspaces', { name: 'Acme Marketing' });
const base = `/workspaces/${ws.id}`;

const prisma = getPrisma();
const existing = await prisma.link.count({ where: { workspaceId: ws.id } });
if (existing > 0) {
  console.log(`Workspace already has ${existing} links; skipping creation.`);
} else {
  const campaign = await call<{ id: string }>('POST', `${base}/campaigns`, {
    name: 'Diwali 2026',
    description: 'Festive season push across social, email and print.',
    startDate: new Date(Date.now() - 20 * 86400e3).toISOString(),
    endDate: new Date(Date.now() + 25 * 86400e3).toISOString(),
    utmCampaign: 'diwali2026',
  });
  const other = await call<{ id: string }>('POST', `${base}/campaigns`, {
    name: 'Product Launch',
    description: 'Spring launch announcements.',
  });
  const mk = (slug: string, destinationUrl: string, extra: object = {}) =>
    call<{ id: string }>('POST', `${base}/links`, { slug, destinationUrl, ...extra });
  const insta = await mk('diwali-insta', 'https://example.com/diwali-sale', {
    title: 'Diwali sale – Instagram',
    campaignId: campaign.id,
    utmSource: 'instagram',
    utmMedium: 'social',
  });
  const fb = await mk('diwali-fb', 'https://example.com/diwali-sale', {
    title: 'Diwali sale – Facebook',
    campaignId: campaign.id,
    utmSource: 'facebook',
    utmMedium: 'social',
  });
  const mail = await mk('diwali-mail', 'https://example.com/diwali-sale', {
    title: 'Diwali sale – Email',
    campaignId: campaign.id,
    utmSource: 'newsletter',
    utmMedium: 'email',
  });
  const poster = await mk('diwali-poster', 'https://example.com/diwali-sale', {
    title: 'Diwali sale – Poster',
    campaignId: campaign.id,
    utmSource: 'offline',
    utmMedium: 'qr',
  });
  const launch = await mk('launch', 'https://example.com/launch', {
    title: 'Launch announcement',
    campaignId: other.id,
  });
  await mk('docs', 'https://example.com/docs/getting-started', { title: 'Getting started guide' });
  await mk('old-promo', 'https://example.com/promo', {
    title: 'Old promo (disabled)',
    isActive: false,
  });
  const qr1 = await call<{ id: string }>('POST', `${base}/qr`, {
    name: 'Diwali poster',
    linkId: poster.id,
    campaignId: campaign.id,
    format: 'svg',
    foregroundColor: '#111111',
    backgroundColor: '#FFFFFF',
    errorCorrection: 'Q',
  });
  await call('POST', `${base}/qr`, {
    name: 'Launch flyer',
    linkId: launch.id,
    format: 'png',
    size: 768,
    foregroundColor: '#0B3D91',
    backgroundColor: '#FFF8E7',
  });
  await call('POST', `${base}/api-keys`, { name: 'Zapier integration', role: 'MEMBER' });
  await call('POST', `${base}/webhooks`, {
    url: 'https://hooks.example.com/go-short',
    events: ['link.created', 'link.updated'],
  }).catch(() => console.log('(webhook skipped: WEBHOOK_ALLOW_INSECURE rules)'));

  // ---- synthetic clicks, through the real processor --------------------------------------------
  const geo = loadGeo(config.GEOIP_DATABASE_PATH, pino({ level: 'silent' }));
  const processor = new BatchProcessor({
    prisma,
    logger: pino({ level: 'silent' }),
    geo,
    hasher: new Hasher(config.SESSION_SECRET),
  });
  const IPS = [
    '49.36.0.1',
    '49.36.12.9',
    '103.21.58.4',
    '8.8.8.8',
    '81.2.69.142',
    '200.160.2.3',
    '202.12.27.33',
    '5.9.0.1',
    '1.1.1.1',
    '24.48.0.1',
  ];
  const UAS = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ];
  const BOTS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'facebookexternalhit/1.1',
  ];
  const REFS: Record<string, Array<string | null>> = {
    [insta.id]: ['https://l.instagram.com/', 'https://www.instagram.com/', null],
    [fb.id]: ['https://l.facebook.com/', 'https://m.facebook.com/'],
    [mail.id]: ['https://mail.google.com/', 'https://outlook.live.com/', null],
    [poster.id]: [null],
    [launch.id]: [
      'https://news.ycombinator.com/',
      'https://t.co/abc',
      'https://www.linkedin.com/',
      null,
    ],
  };
  const weights: Array<[string, number, string | null]> = [
    [insta.id, 38, campaign.id],
    [fb.id, 22, campaign.id],
    [mail.id, 16, campaign.id],
    [poster.id, 14, campaign.id],
    [launch.id, 20, other.id],
  ];
  const events: AnalyticsEvent[] = [];
  let n = 0;
  const rnd = (a: number) => Math.floor(Math.random() * a);
  for (let day = 29; day >= 0; day--) {
    const growth = 1 + (29 - day) / 18; // traffic trends upward
    for (const [linkId, w, campaignId] of weights) {
      const count = Math.round((w / 6) * growth * (0.6 + Math.random() * 0.8));
      for (let i = 0; i < count; i++) {
        const bot = Math.random() < 0.06;
        const ts = Date.now() - day * 86400e3 - rnd(86400e3);
        events.push({
          eventId: `demo-${Date.now()}-${n++}`,
          linkId,
          workspaceId: ws.id,
          campaignId,
          timestamp: ts,
          ip: IPS[rnd(IPS.length)]!.replace(/\.\d+$/, `.${1 + rnd(250)}`).replace(
            /^49\.36\.(\d+)\.(\d+)$/,
            (_m, a, b) => `49.36.${a}.${b}`,
          ),
          userAgent: bot ? BOTS[rnd(BOTS.length)]! : UAS[rnd(UAS.length)]!,
          referer: REFS[linkId]![rnd(REFS[linkId]!.length)] ?? null,
          acceptLanguage: 'en-IN,en;q=0.9',
          forwardedFor: null,
          qrId: linkId === poster.id && Math.random() < 0.8 ? qr1.id : null,
        });
      }
    }
  }
  for (let i = 0; i < events.length; i += 500) await processor.process(events.slice(i, i + 500));
  console.log(`Ingested ${events.length} synthetic clicks.`);
}
console.log(`Done. Sign in as ${EMAIL} / ${PASSWORD}`);
await disconnectPrisma();
