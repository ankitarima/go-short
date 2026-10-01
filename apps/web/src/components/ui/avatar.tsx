import { cn } from '@/lib/cn';

/** Deterministic gradient from a string, in the spirit of Vercel's generated avatars. */
function gradient(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 55) % 360;
  return `linear-gradient(135deg, hsl(${a} 80% 60%), hsl(${b} 85% 55%))`;
}

export function Avatar({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{ width: size, height: size, background: gradient(name || '?') }}
    />
  );
}
