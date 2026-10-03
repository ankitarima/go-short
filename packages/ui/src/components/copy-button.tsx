import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

export function CopyButton({
  value,
  label = 'Copy',
  className,
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'icon';
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context): nothing useful to do */
    }
  }
  return (
    <Button
      variant="secondary"
      size={size}
      className={cn(size === 'icon' && 'size-8', className)}
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <Check className="text-green" /> : <Copy />}
      {size === 'sm' && (copied ? 'Copied' : label)}
    </Button>
  );
}

/** Monospace value with a copy button (DNS records, keys, URLs). */
export function CodeValue({ value, className }: { value: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-surface py-1.5 pl-3 pr-1.5',
        className,
      )}
    >
      <code className="mono-13 min-w-0 flex-1 truncate" title={value}>
        {value}
      </code>
      <CopyButton value={value} size="icon" />
    </div>
  );
}
