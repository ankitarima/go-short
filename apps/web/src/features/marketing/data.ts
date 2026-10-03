import {
  BarChart3,
  BookOpen,
  Building2,
  Code2,
  FileText,
  Globe,
  KeyRound,
  Link2,
  Lock,
  Megaphone,
  Rocket,
  Server,
  ShieldCheck,
  Store,
  Terminal,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export type Accent = 'blue' | 'violet' | 'teal';

export interface Product {
  slug: 'golinks' | 'gocampaigns' | 'goanalytics';
  name: string;
  tagline: string;
  blurb: string;
  icon: LucideIcon;
  accent: Accent;
}

export const PRODUCTS: Product[] = [
  {
    slug: 'golinks',
    name: 'goLinks',
    tagline: 'Short links and QR codes on your own domain',
    blurb:
      'Create branded links in seconds, protect them, schedule them, and print QR codes that scan.',
    icon: Link2,
    accent: 'blue',
  },
  {
    slug: 'gocampaigns',
    name: 'goCampaigns',
    tagline: 'Run every channel as one campaign',
    blurb:
      'Group links and QR codes, standardise UTM tagging, and see the whole campaign in one place.',
    icon: Megaphone,
    accent: 'violet',
  },
  {
    slug: 'goanalytics',
    name: 'goAnalytics',
    tagline: 'Privacy-friendly click and scan analytics',
    blurb: 'Real-time clicks, QR scans, locations, devices and referrers, exact in any timezone.',
    icon: BarChart3,
    accent: 'teal',
  },
];

export const productHref = (p: Product | string): string =>
  `/products/${typeof p === 'string' ? p : p.slug}`;

export interface Solution {
  slug: string;
  name: string;
  tagline: string;
  blurb: string;
  icon: LucideIcon;
}

export const SOLUTIONS: Solution[] = [
  {
    slug: 'marketing',
    name: 'Marketing teams',
    tagline: 'Know which channel actually worked',
    blurb:
      'Consistent UTM tagging, one campaign view and honest numbers across social, email and print.',
    icon: Megaphone,
  },
  {
    slug: 'agencies',
    name: 'Agencies',
    tagline: 'One platform for every client',
    blurb:
      'A workspace per client, custom domains per brand, and read-only access for stakeholders.',
    icon: Building2,
  },
  {
    slug: 'developers',
    name: 'Developers',
    tagline: 'A link platform you can build on',
    blurb: 'A documented REST API, scoped API keys, signed webhooks and an OpenAPI description.',
    icon: Code2,
  },
  {
    slug: 'events-and-retail',
    name: 'Events and retail',
    tagline: 'Bridge print and digital',
    blurb: 'Branded QR codes for posters, packaging and menus, with scan tracking per placement.',
    icon: Store,
  },
];

export const solutionHref = (s: Solution | string): string =>
  `/solutions/${typeof s === 'string' ? s : s.slug}`;

export interface ResourceLink {
  name: string;
  blurb: string;
  href: string;
  icon: LucideIcon;
}

export const RESOURCES: ResourceLink[] = [
  {
    name: 'Documentation',
    blurb: 'Guides for every feature',
    href: '/docs/introduction',
    icon: BookOpen,
  },
  {
    name: 'Quickstart',
    blurb: 'Your first link in five minutes',
    href: '/docs/quickstart',
    icon: Rocket,
  },
  {
    name: 'API reference',
    blurb: 'Endpoints, samples and errors',
    href: '/docs/api',
    icon: Terminal,
  },
  {
    name: 'Authentication',
    blurb: 'API keys and access levels',
    href: '/docs/api/authentication',
    icon: KeyRound,
  },
  {
    name: 'Webhooks',
    blurb: 'Signed events for your systems',
    href: '/docs/webhooks',
    icon: Webhook,
  },
  {
    name: 'Self-hosting',
    blurb: 'Run it on your own server',
    href: '/docs/self-hosting',
    icon: Server,
  },
  {
    name: 'Privacy and data',
    blurb: 'What is stored, and what is not',
    href: '/docs/privacy',
    icon: Lock,
  },
  { name: 'Security', blurb: 'How the platform is hardened', href: '/security', icon: ShieldCheck },
];

export const PLATFORM = [
  { name: 'Custom domains', icon: Globe, href: '/docs/custom-domains' },
  { name: 'Team and roles', icon: Users, href: '/docs/team-and-roles' },
  { name: 'Open API', icon: FileText, href: '/docs/api' },
];

export const ACCENT: Record<Accent, { text: string; bg: string; ring: string; glow: string }> = {
  blue: { text: 'text-blue', bg: 'bg-blue-soft', ring: 'ring-blue/20', glow: 'var(--chart-1)' },
  violet: {
    text: 'text-[var(--chart-2)]',
    bg: 'bg-[color-mix(in_srgb,var(--chart-2)_12%,transparent)]',
    ring: 'ring-[var(--chart-2)]/20',
    glow: 'var(--chart-2)',
  },
  teal: {
    text: 'text-[var(--chart-3)]',
    bg: 'bg-[color-mix(in_srgb,var(--chart-3)_12%,transparent)]',
    ring: 'ring-[var(--chart-3)]/20',
    glow: 'var(--chart-3)',
  },
};
