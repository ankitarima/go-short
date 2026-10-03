import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

const tones = {
  info: { icon: Info, cls: 'border-blue/30 bg-blue-soft text-foreground', ic: 'text-blue' },
  warning: {
    icon: AlertTriangle,
    cls: 'border-amber/40 bg-amber-soft text-foreground',
    ic: 'text-amber',
  },
  danger: { icon: ShieldAlert, cls: 'border-red/30 bg-red-soft text-foreground', ic: 'text-red' },
} as const;

export function Callout({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn('flex gap-3 rounded-lg border p-4', t.cls, className)}
    >
      <t.icon className={cn('mt-0.5 size-4 shrink-0', t.ic)} />
      <div className="copy-14 min-w-0">
        {title && <p className="label-14">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 text-muted-foreground')}>{children}</div>}
      </div>
    </div>
  );
}
