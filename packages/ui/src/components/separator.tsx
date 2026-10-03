import { cn } from '../lib/cn';

export const Separator = ({ className }: { className?: string }) => (
  <div role="separator" className={cn('h-px w-full bg-border', className)} />
);
