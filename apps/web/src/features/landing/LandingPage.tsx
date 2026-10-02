import {
  ArrowRight,
  BarChart3,
  Check,
  Globe,
  KeyRound,
  Link2,
  Megaphone,
  QrCode,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo, LogoMark } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useMeQuery } from '@/hooks/useAuth';

const FEATURES: Array<{ icon: typeof Link2; title: string; body: string }> = [
  {
    icon: Link2,
    title: 'Short links that behave',
    body: 'Custom slugs, password protection, expiry dates and per-link redirect status. Redirects are served from a cache built for speed.',
  },
  {
    icon: Globe,
    title: 'Your own domains',
    body: 'Bring go.yourbrand.com. A guided wizard verifies DNS ownership before a single link goes live.',
  },
  {
    icon: QrCode,
    title: 'QR codes you can trust',
    body: 'Design colours and add a logo with a live preview. Combinations that would not scan are blocked before you print them.',
  },
  {
    icon: Megaphone,
    title: 'Campaigns and UTMs',
    body: 'Group links and QR codes into a campaign, set default UTM values and see the whole picture in one place.',
  },
  {
    icon: BarChart3,
    title: 'Honest analytics',
    body: 'Clicks, countries, devices, referrers and QR scans, in any timezone, with bots separated out and CSV export.',
  },
  {
    icon: Users,
    title: 'Teams and roles',
    body: 'Owners, admins, members and viewers. Invite teammates by email and keep every workspace isolated.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Create a workspace',
    body: 'Sign up and name your workspace. Add your domain or start on the shared one.',
  },
  {
    n: '02',
    title: 'Shorten and design',
    body: 'Paste a long URL, pick a slug, and generate a branded QR code in the same flow.',
  },
  {
    n: '03',
    title: 'Measure what works',
    body: 'Watch clicks and scans arrive, compare campaigns and export the data whenever you like.',
  },
];

const PRINCIPLES = [
  'Open source (MIT) and self-hosted. Your data stays on your servers.',
  'IP addresses are never stored raw; visitors are counted with day-salted hashes.',
  'Passwords hashed with Argon2id. API keys are hashed and shown only once.',
  'A documented REST API with an OpenAPI 3.1 reference and signed webhooks.',
];

export function LandingPage() {
  const me = useMeQuery();
  const signedIn = !!me.data;
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="goShort home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 sm:flex">
            <a href="#features" className="copy-14 text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#how" className="copy-14 text-muted-foreground hover:text-foreground">
              How it works
            </a>
            <a href="#open" className="copy-14 text-muted-foreground hover:text-foreground">
              Open source
            </a>
            <a href="/docs" className="copy-14 text-muted-foreground hover:text-foreground">
              API docs
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <Hero signedIn={signedIn} />

        <section id="features" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
            <SectionHead
              eyebrow="Everything in one place"
              title="From a long URL to a measured campaign"
              body="goShort covers the whole loop: create, brand, share and learn, without handing your data to anyone."
            />
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-background p-6">
                  <span className="grid size-9 place-items-center rounded-md border border-border bg-surface">
                    <f.icon className="size-[18px]" aria-hidden />
                  </span>
                  <h3 className="heading-16 mt-4">{f.title}</h3>
                  <p className="copy-14 mt-1.5 text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-t border-border bg-surface">
          <div className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
            <SectionHead eyebrow="How it works" title="Up and running in three steps" />
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-xl border border-border bg-background p-6">
                  <span className="mono-13 text-subtle-foreground">{s.n}</span>
                  <h3 className="heading-20 mt-3">{s.title}</h3>
                  <p className="copy-14 mt-2 text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="open" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto grid max-w-[1100px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionHead
                align="left"
                eyebrow="Open source, self-hosted"
                title="Your links. Your servers. Your data."
                body="goShort runs on Postgres and Valkey with a handful of small services. There is no vendor to trust and no per-click pricing."
              />
              <ul className="mt-8 flex flex-col gap-3">
                {PRINCIPLES.map((p) => (
                  <li key={p} className="copy-14 flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <KeyRound className="size-3.5 text-subtle-foreground" aria-hidden />
                <span className="label-12 text-muted-foreground">Create a link from a script</span>
              </div>
              <pre className="mono-13 overflow-x-auto p-4 leading-6">
                <span className="text-subtle-foreground">$ </span>curl -X POST /api/v1/links \{'\n'}
                {'  '}-H <span className="text-green">"Authorization: Bearer $KEY"</span> \{'\n'}
                {'  '}-H <span className="text-green">"Content-Type: application/json"</span> \
                {'\n'}
                {'  '}-d{' '}
                <span className="text-blue">
                  {'\'{"destinationUrl":"https://example.com/sale",'}
                  {'\n'}
                  {'     '}
                  {'"slug":"sale"}\''}
                </span>
              </pre>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-[1100px] flex-col items-center px-4 py-20 text-center sm:px-6">
            <ShieldCheck className="size-6 text-muted-foreground" aria-hidden />
            <h2 className="heading-32 mt-4 max-w-xl text-balance">
              Ready to shorten your first link?
            </h2>
            <p className="copy-14 mt-3 max-w-md text-muted-foreground">
              Create a free workspace and have a branded short link and QR code in under a minute.
            </p>
            <Button asChild size="md" className="mt-8 h-11 px-6">
              <Link to={signedIn ? '/dashboard' : '/register'}>
                {signedIn ? 'Go to your dashboard' : 'Get started'} <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark size={18} />
            <span className="copy-13 text-muted-foreground">goShort · MIT licensed</span>
          </div>
          <nav aria-label="Footer" className="flex gap-5">
            <a href="/docs" className="copy-13 text-muted-foreground hover:text-foreground">
              API reference
            </a>
            <Link to="/login" className="copy-13 text-muted-foreground hover:text-foreground">
              Log in
            </Link>
            <Link to="/register" className="copy-13 text-muted-foreground hover:text-foreground">
              Sign up
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
      <p className="label-14 text-blue">{eyebrow}</p>
      <h2 className="heading-32 mt-2 text-balance">{title}</h2>
      {body && <p className="copy-14 mt-3 text-muted-foreground">{body}</p>}
    </div>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_40%,transparent_100%)]"
      />
      <div className="relative mx-auto max-w-[1100px] px-4 pb-8 pt-16 text-center sm:px-6 sm:pt-24">
        <a
          href="#features"
          className="label-12 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-muted-foreground hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-green" aria-hidden />
          Open source · self-hosted
        </a>
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.045em] sm:text-[64px]">
          Short links, QR codes and campaign analytics.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg">
          goShort is the link platform you run yourself. Brand your links, design QR codes that
          scan, and see what works, with privacy built in.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild className="h-11 px-6">
            <Link to={signedIn ? '/dashboard' : '/register'}>
              {signedIn ? 'Open dashboard' : 'Start for free'} <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="secondary" className="h-11 px-6">
            <a href="/docs">Read the API docs</a>
          </Button>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}

/** A stylised, static illustration of the product. It shows no real or invented customer numbers. */
function ProductPreview() {
  return (
    <div
      aria-hidden
      className="mx-auto mt-16 max-w-4xl overflow-hidden rounded-xl border border-border bg-background text-left shadow-[0_20px_60px_-30px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface px-4 py-3">
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="mono-13 mx-auto rounded-md border border-border bg-background px-3 py-0.5 text-subtle-foreground">
          go.yourbrand.com
        </span>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-[1.4fr_1fr]">
        <div className="bg-background p-5">
          <div className="flex items-center justify-between">
            <span className="label-14">Clicks, last 30 days</span>
            <span className="label-12 rounded-full bg-blue-soft px-2 py-0.5 text-blue">Live</span>
          </div>
          <svg viewBox="0 0 400 120" className="mt-4 h-32 w-full" role="presentation">
            <defs>
              <linearGradient id="lp-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.25" />
                <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 95 C30 90 50 60 80 70 S130 100 160 62 S220 20 250 48 S310 80 340 36 S385 24 400 18 L400 120 L0 120Z"
              fill="url(#lp-fill)"
            />
            <path
              d="M0 95 C30 90 50 60 80 70 S130 100 160 62 S220 20 250 48 S310 80 340 36 S385 24 400 18"
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="2"
            />
          </svg>
          <div className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border">
            {[
              ['go.yourbrand.com/launch', 'Product launch'],
              ['go.yourbrand.com/menu', 'Table QR'],
              ['go.yourbrand.com/news', 'Newsletter'],
            ].map(([url, tag]) => (
              <div key={url} className="flex items-center justify-between px-3 py-2.5">
                <span className="mono-13">{url}</span>
                <span className="label-12 rounded-full bg-hover px-2 py-0.5 text-muted-foreground">
                  {tag}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 bg-surface p-5">
          <div className="rounded-lg border border-border bg-white p-3">
            <svg viewBox="0 0 21 21" className="size-32" shapeRendering="crispEdges">
              <rect width="21" height="21" fill="#fff" />
              {QR_CELLS.map(([x, y]) => (
                <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#000" />
              ))}
              {[
                [0, 0],
                [14, 0],
                [0, 14],
              ].map(([x, y]) => (
                <g key={`f${x}${y}`}>
                  <rect x={x} y={y} width="7" height="7" fill="#000" />
                  <rect x={x! + 1} y={y! + 1} width="5" height="5" fill="#fff" />
                  <rect x={x! + 2} y={y! + 2} width="3" height="3" fill="#000" />
                </g>
              ))}
            </svg>
          </div>
          <div className="text-center">
            <div className="label-14">Branded QR code</div>
            <div className="copy-13 text-muted-foreground">Contrast checked before you print</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Decorative pseudo-random modules (not a scannable code). */
const QR_CELLS: Array<[number, number]> = (() => {
  const cells: Array<[number, number]> = [];
  let seed = 7;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      const inFinder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (!inFinder && seed % 100 < 48) cells.push([x, y]);
    }
  }
  return cells;
})();
