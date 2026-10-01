import type {
  Analytics,
  Campaign,
  Domain,
  Link,
  Me,
  Member,
  Overview,
  Qr,
  Role,
} from '@/types/api';

export const WS_ID = 'ws_1';

export const makeMe = (role: Role = 'OWNER', extra: Partial<Me['user']> = {}): Me => ({
  user: {
    id: 'u_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    emailVerified: true,
    systemRole: 'USER',
    ...extra,
  },
  csrfToken: 'csrf-token-123',
  workspaces: [{ id: WS_ID, name: 'Acme', slug: 'acme', role }],
});

export const makeLink = (over: Partial<Link> = {}): Link => ({
  id: 'l_1',
  domainId: 'd_1',
  hostname: 'go.example.com',
  slug: 'sale',
  shortUrl: 'https://go.example.com/sale',
  destinationUrl: 'https://example.com/summer',
  title: 'Summer sale',
  description: null,
  campaignId: null,
  isActive: true,
  expiresAt: null,
  expired: false,
  hasPassword: false,
  redirectStatus: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

export const makeCampaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'c_1',
  name: 'Diwali 2026',
  description: null,
  startDate: null,
  endDate: null,
  utmCampaign: 'diwali2026',
  linkCount: 3,
  qrCodeCount: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

export const makeDomain = (over: Partial<Domain> = {}): Domain => ({
  id: 'd_1',
  hostname: 'go.example.com',
  status: 'VERIFIED',
  isVerified: true,
  isDefault: false,
  shared: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  dns: null,
  ...over,
});

export const makeQr = (over: Partial<Qr> = {}): Qr => ({
  id: 'q_1',
  name: 'Poster',
  linkId: 'l_1',
  campaignId: null,
  format: 'svg',
  size: 512,
  margin: 2,
  errorCorrection: 'M',
  foregroundColor: '#000000',
  backgroundColor: '#FFFFFF',
  hasLogo: false,
  url: 'https://go.example.com/sale?qr=q_1',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

export const makeMember = (over: Partial<Member> = {}): Member => ({
  id: 'm_1',
  role: 'MEMBER',
  createdAt: '2026-09-01T10:00:00.000Z',
  user: { id: 'u_2', email: 'grace@example.com', name: 'Grace Hopper' },
  ...over,
});

export const overview: Overview = { links: 7, campaigns: 2, qrCodes: 3, domains: 1, members: 2 };

export const analytics: Analytics = {
  summary: { clicks: 1200, humanClicks: 1100, botClicks: 100, uniqueVisitors: 900, qrScans: 40 },
  timeline: [
    { date: '2026-09-01', clicks: 10, humanClicks: 9, botClicks: 1 },
    { date: '2026-09-02', clicks: 20, humanClicks: 18, botClicks: 2 },
  ],
  countries: [
    { value: 'IN', clicks: 700 },
    { value: 'US', clicks: 300 },
  ],
  regions: [],
  cities: [{ value: 'Mumbai, IN', clicks: 400 }],
  devices: [
    { value: 'MOBILE', clicks: 800 },
    { value: 'DESKTOP', clicks: 400 },
  ],
  browsers: [{ value: 'Chrome', clicks: 900 }],
  os: [{ value: 'Android', clicks: 700 }],
  referrers: [
    { value: '(direct)', clicks: 600 },
    { value: 't.co', clicks: 200 },
  ],
  utmSources: [{ value: 'instagram', clicks: 500 }],
  utmMediums: [],
  utmCampaigns: [],
  qrCodes: [{ value: 'q_1', clicks: 40, name: 'Poster' }],
  topLinks: [
    {
      linkId: 'l_1',
      clicks: 500,
      slug: 'sale',
      title: null,
      hostname: 'go.example.com',
      deleted: false,
    },
  ],
  meta: {
    timezone: 'UTC',
    from: '2026-09-01',
    to: '2026-09-02',
    granularity: 'day',
    includeBots: true,
    source: 'rollup',
    notes: ['Unique visitors are approximate.'],
  },
};
