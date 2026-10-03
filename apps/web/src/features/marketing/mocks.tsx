import { Check, Globe, Link2, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Static product illustrations. They are decorative (aria-hidden) and show no customer data. */

export function Frame({
  url,
  children,
  className,
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-background shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="mono-13 mx-auto rounded-md border border-border bg-background px-3 py-0.5 text-[12px] text-subtle-foreground">
          {url}
        </span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

const pill = (tone: 'green' | 'amber' | 'gray' | 'blue', text: string) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      tone === 'green' && 'bg-green-soft text-green',
      tone === 'amber' && 'bg-amber-soft text-amber',
      tone === 'blue' && 'bg-blue-soft text-blue',
      tone === 'gray' && 'bg-hover text-muted-foreground',
    )}
  >
    <span className="size-1.5 rounded-full bg-current" />
    {text}
  </span>
);

export function LinksMock() {
  const rows = [
    ['go.brand.com/summer', 'brand.com/collections/summer-2026', 'green', 'Active'],
    ['go.brand.com/menu', 'brand.com/restaurant/menu.pdf', 'green', 'Active'],
    ['go.brand.com/launch', 'brand.com/launch?ref=email', 'amber', 'Scheduled'],
    ['go.brand.com/early', 'brand.com/early-access', 'gray', 'Expired'],
  ] as const;
  return (
    <Frame url="app.goshort.dev/links">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">Links</div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-[12px] text-subtle-foreground">
              <Search className="size-3.5" /> Search links
            </div>
            <div className="grid h-8 place-items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground">
              Create link
            </div>
          </div>
        </div>
        <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map(([short, dest, tone, label]) => (
            <div key={short} className="flex items-center gap-3 px-3 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface">
                <Link2 className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mono-13 truncate font-medium">{short}</div>
                <div className="truncate text-[12px] text-muted-foreground">{dest}</div>
              </div>
              {pill(tone, label)}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function DomainMock() {
  return (
    <Frame url="app.goshort.dev/domains">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Globe className="size-4" /> go.brand.com
          </div>
          {pill('green', 'Verified')}
        </div>
        <div className="mt-4 rounded-lg border border-border">
          <div className="border-b border-border bg-surface px-3 py-2 text-[12px] font-medium text-muted-foreground">
            DNS record
          </div>
          {[
            ['Type', 'CNAME'],
            ['Name', 'go.brand.com'],
            ['Value', 'links.goshort.dev'],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between border-b border-border px-3 py-2.5 last:border-b-0"
            >
              <span className="text-[12px] text-muted-foreground">{k}</span>
              <span className="mono-13">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-green">
          <Check className="size-3.5" /> HTTPS certificate issued automatically
        </div>
      </div>
    </Frame>
  );
}

const QR: Array<[number, number]> = (() => {
  const cells: Array<[number, number]> = [];
  let seed = 11;
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      const finder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (!finder && seed % 100 < 48) cells.push([x, y]);
    }
  return cells;
})();

export function QrArt({
  className,
  fg = '#000',
  bg = '#fff',
}: {
  className?: string;
  fg?: string;
  bg?: string;
}) {
  return (
    <svg viewBox="0 0 21 21" className={className} shapeRendering="crispEdges">
      <rect width="21" height="21" fill={bg} />
      {QR.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fg} />
      ))}
      {[
        [0, 0],
        [14, 0],
        [0, 14],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <rect x={x} y={y} width="7" height="7" fill={fg} />
          <rect x={x! + 1} y={y! + 1} width="5" height="5" fill={bg} />
          <rect x={x! + 2} y={y! + 2} width="3" height="3" fill={fg} />
        </g>
      ))}
    </svg>
  );
}

export function QrMock() {
  return (
    <Frame url="app.goshort.dev/qr/new">
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div className="text-[15px] font-semibold">QR designer</div>
          {[
            ['Foreground', '#0B1B3A'],
            ['Background', '#FFFFFF'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[12px] text-muted-foreground">{k}</div>
              <div className="mt-1 flex h-9 items-center gap-2 rounded-md border border-border px-2.5">
                <span className="size-5 rounded border border-border" style={{ background: v }} />
                <span className="mono-13">{v}</span>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {pill('green', 'Contrast 12.8:1')}
            {pill('blue', 'Error correction H')}
          </div>
        </div>
        <div className="grid place-items-center rounded-xl border border-border bg-surface p-4">
          <QrArt className="size-36 rounded-md" fg="#0B1B3A" />
          <div className="mt-2 text-[12px] text-muted-foreground">Live preview</div>
        </div>
      </div>
    </Frame>
  );
}

const rowBar = (label: string, tag: string, w: number, color: string) => (
  <div key={label} className="flex items-center gap-3 py-2">
    <div className="w-24 shrink-0">
      <div className="text-[13px] font-medium">{label}</div>
      <div className="mono-13 text-[11px] text-subtle-foreground">{tag}</div>
    </div>
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-hover">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  </div>
);

export function CampaignsMock() {
  return (
    <Frame url="app.goshort.dev/campaigns/diwali-2026">
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[17px] font-semibold tracking-tight">Diwali 2026</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              utm_campaign=diwali2026 · 3 links · 1 QR code
            </div>
          </div>
          {pill('green', 'Active')}
        </div>
        <div className="mt-4 divide-y divide-border rounded-lg border border-border px-3">
          {rowBar('Instagram', 'instagram / social', 78, 'var(--chart-1)')}
          {rowBar('Facebook', 'facebook / social', 46, 'var(--chart-2)')}
          {rowBar('Poster QR', 'offline / qr', 62, 'var(--chart-3)')}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {['Clicks', 'QR scans', 'Visitors'].map((l) => (
            <div key={l} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{l}</div>
              <div className="skeleton mt-1.5 h-4 w-12 rounded" />
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function AnalyticsMock() {
  const countries = [
    ['India', 72],
    ['United States', 41],
    ['Germany', 23],
    ['United Kingdom', 18],
  ] as const;
  return (
    <Frame url="app.goshort.dev/analytics">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">Analytics</div>
          <div className="flex gap-1 rounded-full border border-border p-0.5 text-[11px]">
            {['7d', '30d', '90d'].map((x, i) => (
              <span
                key={x}
                className={cn(
                  'rounded-full px-2.5 py-0.5',
                  i === 1 && 'bg-foreground text-background',
                )}
              >
                {x}
              </span>
            ))}
          </div>
        </div>
        <svg viewBox="0 0 400 110" className="mt-4 h-28 w-full" role="presentation">
          <defs>
            <linearGradient id="am-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--chart-3)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--chart-3)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 88 C30 80 55 50 85 58 S135 92 165 56 S225 14 255 40 S315 74 345 30 S385 20 400 14 L400 110 L0 110Z"
            fill="url(#am-fill)"
          />
          <path
            d="M0 88 C30 80 55 50 85 58 S135 92 165 56 S225 14 255 40 S315 74 345 30 S385 20 400 14"
            fill="none"
            stroke="var(--chart-3)"
            strokeWidth="2"
          />
        </svg>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label-12 mb-1 text-muted-foreground">Countries</div>
            {countries.map(([c, w]) => (
              <div
                key={c}
                className="relative my-1 flex h-7 items-center overflow-hidden rounded px-2 text-[12px]"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded bg-[color-mix(in_srgb,var(--chart-3)_16%,transparent)]"
                  style={{ width: `${w}%` }}
                />
                <span className="relative">{c}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="label-12 mb-1 text-muted-foreground">Devices</div>
            {[
              ['Mobile', 64],
              ['Desktop', 30],
              ['Tablet', 6],
            ].map(([c, w]) => (
              <div
                key={String(c)}
                className="relative my-1 flex h-7 items-center overflow-hidden rounded px-2 text-[12px]"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded bg-[color-mix(in_srgb,var(--chart-1)_16%,transparent)]"
                  style={{ width: `${w}%` }}
                />
                <span className="relative">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

export const MOCKS = {
  links: LinksMock,
  domain: DomainMock,
  qr: QrMock,
  campaigns: CampaignsMock,
  analytics: AnalyticsMock,
} as const;
export type MockId = keyof typeof MOCKS;
