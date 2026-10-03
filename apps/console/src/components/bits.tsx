import { Search } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@go-short/ui/components/badge';
import { Pagination } from '@go-short/ui/components/pagination';
import type { PagerState } from '@/hooks/usePaging';
import { Input } from '@go-short/ui/components/input';
import { ROLE_LABEL } from '@/lib/format';

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
        aria-hidden
      />
      <Input
        aria-label={placeholder}
        className="pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function PagerFooter({ pager }: { pager: PagerState }) {
  return <Pagination {...pager} />;
}

export function RoleBadge({ role }: { role: keyof typeof ROLE_LABEL }) {
  const tone =
    role === 'SUPER_ADMIN' || role === 'OWNER'
      ? 'inverted'
      : role === 'ADMIN'
        ? 'blue'
        : role === 'USER'
          ? 'outline'
          : 'gray';
  return <Badge tone={tone}>{ROLE_LABEL[role]}</Badge>;
}

export function StatusBadge({ disabled }: { disabled: boolean }) {
  return disabled ? (
    <Badge tone="red" dot>
      Suspended
    </Badge>
  ) : (
    <Badge tone="green" dot>
      Active
    </Badge>
  );
}

const fmtDay = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A quiet area chart: one series, hairline grid, no legend. */
export function SeriesChart({
  data,
  color = 'var(--chart-1)',
  label,
  height = 220,
}: {
  data: Array<{ x: string | number; y: number | null }>;
  color?: string;
  label: string;
  height?: number;
}) {
  const id = `fill-${label.replace(/\W/g, '')}`;
  const isDate = typeof data[0]?.x === 'string';
  return (
    <div role="img" aria-label={`${label} over time`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.25} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="x"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
            tickFormatter={(v: string | number) =>
              isDate
                ? fmtDay(String(v))
                : new Date(Number(v)).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) =>
              isDate ? fmtDay(String(v)) : new Date(Number(v)).toLocaleString()
            }
            formatter={(v) => [v as number, label]}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
