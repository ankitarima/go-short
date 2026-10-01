import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '@/lib/format';

interface Point {
  date: string;
  clicks: number;
  humanClicks: number;
  botClicks: number;
}

function label(date: string, hourly: boolean): string {
  const d = new Date(hourly ? `${date}:00` : `${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return hourly
    ? d.toLocaleTimeString('en-US', { hour: 'numeric' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChartTooltip({
  active,
  payload,
  hourly,
  showBots,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  hourly: boolean;
  showBots: boolean;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const d = new Date(hourly ? `${p.date}:00` : `${p.date}T00:00:00`);
  return (
    <div className="rounded-lg bg-background px-3 py-2 text-xs shadow-menu">
      <div className="mb-1 text-muted-foreground">
        {d.toLocaleString(
          'en-US',
          hourly ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-[var(--chart-1)]" />
        <span className="font-medium tabular-nums">{formatNumber(p.humanClicks)}</span>
        <span className="text-muted-foreground">clicks</span>
      </div>
      {showBots && (
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--chart-muted)]" />
          <span className="font-medium tabular-nums">{formatNumber(p.botClicks)}</span>
          <span className="text-muted-foreground">bots</span>
        </div>
      )}
    </div>
  );
}

/** Clicks over time. Human clicks are the blue area; bot clicks (when included) stack in grey. */
export function TimelineChart({
  data,
  hourly = false,
  showBots,
  height = 280,
}: {
  data: Point[];
  hourly?: boolean;
  showBots: boolean;
  height?: number;
}) {
  const empty = data.every((d) => d.clicks === 0);
  return (
    <div role="img" aria-label="Clicks over time" style={{ height }} className="relative w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="fill-human" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={32}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
            tickFormatter={(v: string) => label(v, hourly)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
            tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)' }}
            content={<ChartTooltip hourly={hourly} showBots={showBots} />}
          />
          {showBots && (
            <Area
              type="monotone"
              dataKey="botClicks"
              stackId="1"
              stroke="var(--chart-muted)"
              strokeWidth={1.5}
              fill="var(--chart-muted)"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="humanClicks"
            stackId="1"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#fill-human)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-subtle-foreground">
          No clicks in this period
        </div>
      )}
    </div>
  );
}
