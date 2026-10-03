import {
  BarChart3,
  Bell,
  CalendarClock,
  Clock,
  Download,
  EyeOff,
  Filter,
  Globe,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Megaphone,
  QrCode,
  RefreshCw,
  Shield,
  Tags,
  Timer,
  Trash2,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import type { MockId } from './mocks';
import type { Feature } from './sections';
import type { Accent } from './data';

export interface SplitContent {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  mock: MockId;
  link?: { label: string; to: string };
}

export interface ProductContent {
  title: string;
  subtitle: string;
  accent: Accent;
  heroMock: MockId;
  splits: SplitContent[];
  featuresTitle: string;
  features: Feature[];
  faq: Array<{ q: string; a: string }>;
  related: Array<'golinks' | 'gocampaigns' | 'goanalytics'>;
}

export const PRODUCT_CONTENT: Record<string, ProductContent> = {
  golinks: {
    title: 'Short links your brand can trust',
    subtitle:
      'Create branded links on your own domain, protect and schedule them, and print QR codes that actually scan. Every click is measured.',
    accent: 'blue',
    heroMock: 'links',
    splits: [
      {
        eyebrow: 'Custom domains',
        title: 'Your domain, not ours',
        body: 'Use go.yourbrand.com for every link. Add one DNS record, verify, and you are live with HTTPS.',
        bullets: [
          'Verify ownership with a CNAME or a TXT record',
          'Certificates are issued automatically for verified domains',
          'One hostname belongs to one workspace, so nobody can claim yours',
        ],
        mock: 'domain',
        link: { label: 'Custom domains guide', to: '/docs/custom-domains' },
      },
      {
        eyebrow: 'Control',
        title: 'Every link, fully in your hands',
        body: 'Pick the slug, decide who gets in, and decide when the link stops. Changes take effect immediately.',
        bullets: [
          'Custom slugs, or a random 7-character slug',
          'Password protection and expiry dates',
          'Choose 301, 302, 307 or 308 per link',
          'Disable or re-enable in one click',
        ],
        mock: 'links',
        link: { label: 'Short links guide', to: '/docs/short-links' },
      },
      {
        eyebrow: 'QR codes',
        title: 'QR codes that are guaranteed to scan',
        body: 'Design with your colours and logo and watch the preview update. Combinations scanners struggle with are blocked before you print.',
        bullets: [
          'Live preview, SVG and PNG downloads',
          'Contrast and inversion checks built in',
          'Logos are re-encoded safely; error correction is raised automatically',
          'Every scan is counted on the link it points to',
        ],
        mock: 'qr',
        link: { label: 'QR codes guide', to: '/docs/qr-codes' },
      },
    ],
    featuresTitle: 'Everything a link needs',
    features: [
      {
        icon: Tags,
        title: 'UTM built in',
        body: 'Source, medium, campaign, term and content are added to the destination for you, without duplicating values it already has.',
      },
      {
        icon: Zap,
        title: 'Fast redirects',
        body: 'Links are resolved from a cache with a database fallback, and changes clear stale copies immediately.',
      },
      {
        icon: Webhook,
        title: 'Webhooks',
        body: 'Get signed events when links are created, changed or deleted.',
      },
      {
        icon: KeyRound,
        title: 'API and API keys',
        body: 'Create and manage links from your own tools with scoped keys.',
      },
      {
        icon: Users,
        title: 'Team access',
        body: 'Owners, admins, members and viewers, with an audit log for admins.',
      },
      {
        icon: Globe,
        title: 'Shared domain included',
        body: 'Start on the shared short domain, move to your own whenever you are ready.',
      },
    ],
    faq: [
      {
        q: 'Can I use my own domain?',
        a: 'Yes. Add the hostname, create the DNS record shown (CNAME for subdomains, TXT for apex domains), and verify. Links on a domain only work once it is verified.',
      },
      {
        q: 'What do visitors see when a link is disabled or expired?',
        a: 'A clear message page. Operators can instead configure a fallback URL that visitors are redirected to.',
      },
      {
        q: 'Do permanent redirects (301) hurt analytics?',
        a: 'Browsers may remember 301 and 308 redirects and skip goShort on repeat visits, so those repeat clicks are not counted. 302 and 307 are counted every time.',
      },
      {
        q: 'Is there an API?',
        a: 'Yes. Everything above is available over a documented REST API with scoped API keys.',
      },
    ],
    related: ['gocampaigns', 'goanalytics'],
  },
  gocampaigns: {
    title: 'Every channel, one campaign',
    subtitle:
      'Group links and QR codes, tag them consistently, and see how the whole campaign performed instead of stitching spreadsheets together.',
    accent: 'violet',
    heroMock: 'campaigns',
    splits: [
      {
        eyebrow: 'Plan',
        title: 'Tag consistently, without the spreadsheet',
        body: 'Give a campaign its name, dates and default utm_campaign. Every link you add inherits it, and you only set the source and medium.',
        bullets: [
          'Start and end dates with Scheduled, Active and Ended states',
          'A default utm_campaign for the whole campaign',
          'Per-link source, medium, term and content',
        ],
        mock: 'links',
        link: { label: 'Campaigns guide', to: '/docs/campaigns' },
      },
      {
        eyebrow: 'Online and offline',
        title: 'Print and digital in the same report',
        body: 'QR codes belong to a link, and links belong to a campaign. A poster scan lands in the same dashboard as an Instagram click, counted separately as a scan.',
        bullets: [
          'QR codes inherit the campaign of their link',
          'Scans are tracked apart from other clicks on the same link',
          'Compare channels side by side',
        ],
        mock: 'qr',
        link: { label: 'QR codes guide', to: '/docs/qr-codes' },
      },
      {
        eyebrow: 'Results',
        title: 'One view of what happened',
        body: 'The campaign page rolls up clicks, scans, locations, devices and referrers for everything in it. Facts, never rankings.',
        bullets: [
          'Totals, timeline and top links for the campaign',
          'Breakdowns by UTM source, medium and campaign',
          'Export the campaign data as CSV',
        ],
        mock: 'analytics',
        link: { label: 'Analytics guide', to: '/docs/analytics' },
      },
    ],
    featuresTitle: 'Built for the way campaigns run',
    features: [
      {
        icon: CalendarClock,
        title: 'Scheduling',
        body: 'See at a glance what is scheduled, running and finished.',
      },
      {
        icon: Tags,
        title: 'Default UTM',
        body: 'Set utm_campaign once; links without their own value inherit it.',
      },
      {
        icon: Layers,
        title: 'Links and QR together',
        body: 'Everything for a campaign lives in one place.',
      },
      {
        icon: Trash2,
        title: 'Safe deletion',
        body: 'Deleting a campaign keeps its links and QR codes. Nothing disappears by accident.',
      },
      { icon: Webhook, title: 'Webhooks', body: 'Be notified when campaigns are created.' },
      {
        icon: Download,
        title: 'Export',
        body: 'Download campaign analytics as CSV for your own reporting.',
      },
    ],
    faq: [
      {
        q: 'What happens to links when I delete a campaign?',
        a: 'They stay. Links and QR codes simply no longer belong to a campaign, and their cached redirects are refreshed so new clicks are not attributed to it.',
      },
      {
        q: 'Does goShort rank my channels?',
        a: 'No. Campaign pages show facts (clicks, scans, locations, referrers) and leave the conclusions to you.',
      },
      {
        q: 'Can a link move between campaigns?',
        a: 'Yes. Daily totals follow a link’s current campaign, while individual click records keep the campaign at the time of the click.',
      },
    ],
    related: ['golinks', 'goanalytics'],
  },
  goanalytics: {
    title: 'Know what works, without tracking people',
    subtitle:
      'Clicks, QR scans, locations, devices and referrers in near real time, exact in your timezone, with privacy built into how the data is collected.',
    accent: 'teal',
    heroMock: 'analytics',
    splits: [
      {
        eyebrow: 'Insight',
        title: 'The numbers you actually need',
        body: 'Open a dashboard and see the story: how many clicks and scans, from where, on what device, and from which referrer.',
        bullets: [
          'Clicks split into human and bot traffic',
          'Countries, regions and cities; devices, browsers and operating systems',
          'Referrers and UTM source, medium and campaign',
        ],
        mock: 'campaigns',
      },
      {
        eyebrow: 'Accuracy',
        title: 'Exact in your timezone',
        body: 'Timelines are computed from fine-grained buckets, so a day starts when your day starts, including half-hour zones like India (+5:30) and Nepal (+5:45).',
        bullets: [
          'Hourly or daily timelines, up to 366 days',
          'Filter by link, campaign, country and device',
          'Plain-language notes explain what is approximate',
        ],
        mock: 'analytics',
        link: { label: 'How accurate is it?', to: '/docs/analytics' },
      },
      {
        eyebrow: 'Privacy',
        title: 'Useful data, minimal personal data',
        body: 'Raw IP addresses are never stored. Visitors are counted with a hash that changes every day, so people cannot be followed across days.',
        bullets: [
          'No raw IPs, full referrer URLs or query strings stored',
          'Choose how long individual click records are kept',
          'CSV exports never include IPs or visitor hashes',
        ],
        mock: 'links',
        link: { label: 'Privacy and data', to: '/docs/privacy' },
      },
    ],
    featuresTitle: 'Analytics that respects your visitors',
    features: [
      {
        icon: Clock,
        title: 'Near real time',
        body: 'Clicks usually appear within seconds, and are queued safely if the system is busy.',
      },
      {
        icon: Filter,
        title: 'Filters',
        body: 'Slice by date range, link, country, device and bot traffic.',
      },
      {
        icon: BarChart3,
        title: 'QR scan tracking',
        body: 'See scans separately from other clicks on the same link.',
      },
      {
        icon: EyeOff,
        title: 'Bots, separated',
        body: 'Bot traffic is stored and shown apart, never silently dropped.',
      },
      {
        icon: Timer,
        title: 'Retention control',
        body: 'Delete raw click records after the number of days you choose.',
      },
      {
        icon: Download,
        title: 'CSV export',
        body: 'Daily totals or individual click records, ready for your own tools.',
      },
    ],
    faq: [
      {
        q: 'How are unique visitors counted?',
        a: 'From a hash of the visitor’s address and browser with a secret that changes daily, once per link per day. It is approximate by design, and over several days the total is the sum of daily uniques.',
      },
      {
        q: 'Is location data precise?',
        a: 'No. Country is generally reliable; city and region are approximate, and VPNs and mobile networks distort them.',
      },
      {
        q: 'Do I need a cookie banner?',
        a: 'goShort sets no tracking cookies on visitors. Your obligations depend on where you operate; you remain responsible for compliance with the laws that apply to you.',
      },
    ],
    related: ['golinks', 'gocampaigns'],
  },
};

export interface SolutionContent {
  title: string;
  subtitle: string;
  challenges: Array<{ icon: typeof Link2; title: string; body: string }>;
  steps: Array<{ title: string; body: string }>;
  products: Array<'golinks' | 'gocampaigns' | 'goanalytics'>;
  heroMock: MockId;
}

export const SOLUTION_CONTENT: Record<string, SolutionContent> = {
  marketing: {
    title: 'Know which channel actually worked',
    subtitle:
      'Consistent tagging, one campaign view and honest numbers across social, email, paid and print.',
    heroMock: 'campaigns',
    challenges: [
      {
        icon: Tags,
        title: 'Inconsistent UTM tags',
        body: 'Set the campaign name once and let every link inherit it. Only the source and medium change per channel.',
      },
      {
        icon: Layers,
        title: 'Results scattered across tools',
        body: 'Links, QR codes and analytics for a campaign live on one page.',
      },
      {
        icon: BarChart3,
        title: 'Numbers you cannot trust',
        body: 'Bots are separated and every approximate figure is labelled as such.',
      },
    ],
    steps: [
      {
        title: 'Create the campaign',
        body: 'Name it, set the dates and the default utm_campaign.',
      },
      {
        title: 'Add a link per channel',
        body: 'Instagram, email, partners, print: each with its own source and medium.',
      },
      {
        title: 'Review the results',
        body: 'Compare channels, then export the data if you need it elsewhere.',
      },
    ],
    products: ['gocampaigns', 'golinks', 'goanalytics'],
  },
  agencies: {
    title: 'One platform for every client',
    subtitle:
      'Keep each client’s links, domains and data separate, and give stakeholders exactly the access they need.',
    heroMock: 'links',
    challenges: [
      {
        icon: Users,
        title: 'Client separation',
        body: 'Create a workspace per client. Data, domains and members never mix.',
      },
      {
        icon: Globe,
        title: 'Every brand on its own domain',
        body: 'Attach each client’s domain to their workspace; HTTPS is automatic once verified.',
      },
      {
        icon: Lock,
        title: 'Safe sharing',
        body: 'Invite clients as viewers for read-only access, and review changes in the audit log.',
      },
    ],
    steps: [
      {
        title: 'Create a workspace',
        body: 'One per client, with its own timezone and privacy settings.',
      },
      { title: 'Connect their domain', body: 'Verify DNS once; links go live on their brand.' },
      {
        title: 'Invite the team',
        body: 'Members for your staff, viewers for client stakeholders.',
      },
    ],
    products: ['golinks', 'gocampaigns', 'goanalytics'],
  },
  developers: {
    title: 'A link platform you can build on',
    subtitle:
      'Create links, QR codes and campaigns from code, read analytics into your own tools, and react to changes with signed webhooks.',
    heroMock: 'links',
    challenges: [
      {
        icon: KeyRound,
        title: 'Scoped API keys',
        body: 'Read-only or read and write, bound to one workspace, revocable at any time.',
      },
      {
        icon: Webhook,
        title: 'Signed webhooks',
        body: 'HMAC-signed deliveries with replay protection, retries and SSRF-hardened delivery.',
      },
      {
        icon: RefreshCw,
        title: 'A documented contract',
        body: 'An OpenAPI 3.1 description and an API reference with ready-to-copy samples.',
      },
    ],
    steps: [
      { title: 'Create an API key', body: 'Admins create keys in the app; the key is shown once.' },
      { title: 'Call the API', body: 'cURL, JavaScript or Python: copy a sample and go.' },
      { title: 'Subscribe to events', body: 'Verify the signature and keep your systems in sync.' },
    ],
    products: ['golinks', 'goanalytics', 'gocampaigns'],
  },
  'events-and-retail': {
    title: 'Bridge print and digital',
    subtitle:
      'Branded QR codes for posters, packaging, menus and shelves, with scan tracking for every placement.',
    heroMock: 'qr',
    challenges: [
      {
        icon: QrCode,
        title: 'Codes that scan in the real world',
        body: 'Contrast and inversion checks stop unreadable designs before they reach the printer.',
      },
      {
        icon: Link2,
        title: 'Change it after it is printed',
        body: 'The QR points at a short link. Change the destination later without reprinting.',
      },
      {
        icon: Megaphone,
        title: 'Measure every placement',
        body: 'Create a QR code per location and compare scans in one campaign.',
      },
    ],
    steps: [
      { title: 'Create a link', body: 'Point it at the page you want visitors to reach.' },
      { title: 'Design the QR code', body: 'Add your colours and logo; download SVG for print.' },
      {
        title: 'Track the scans',
        body: 'See scans by location, device and time, apart from other clicks.',
      },
    ],
    products: ['golinks', 'gocampaigns', 'goanalytics'],
  },
};

export const SECURITY_PILLARS = [
  {
    icon: Shield,
    title: 'You own the data',
    body: 'goShort is open source and self-hosted. Your links, visitors’ aggregated data and backups stay on your servers.',
  },
  {
    icon: EyeOff,
    title: 'Privacy by design',
    body: 'Raw IP addresses are never stored. Visitor hashes use a secret that changes daily, and click records can be deleted on a schedule you choose.',
  },
  {
    icon: Users,
    title: 'Access control',
    body: 'Four roles with a ceiling (nobody can grant more than they have), workspace isolation, and an audit log for admins.',
  },
  {
    icon: KeyRound,
    title: 'Credentials handled properly',
    body: 'Passwords use Argon2id; sessions and API keys are stored hashed; API keys are shown once, scoped, and revocable.',
  },
  {
    icon: Webhook,
    title: 'Hardened integrations',
    body: 'Webhooks are signed with replay protection, and delivery is protected against server-side request forgery.',
  },
  {
    icon: Lock,
    title: 'Defence in depth',
    body: 'CSRF protection, rate limiting (per IP and per account), a strict content security policy and no tracking scripts in the app.',
  },
  {
    icon: Bell,
    title: 'Operable in production',
    body: 'Health checks, Prometheus metrics, Grafana dashboards, alert rules, and tested backup and restore scripts.',
  },
  {
    icon: Zap,
    title: 'Tested, with the evidence public',
    body: 'A threat model and a review log live in the repository, with the tests that enforce each control.',
  },
];
