import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Disclosure({
  title,
  hint,
  children,
  defaultOpen,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <CollapsiblePrimitive.Root
      defaultOpen={defaultOpen}
      className="group rounded-lg border border-border"
    >
      <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-hover/60">
        <ChevronRight className="size-4 text-subtle-foreground transition-transform group-data-[state=open]:rotate-90" />
        {title}
        {hint && <span className="ml-auto text-xs font-normal text-subtle-foreground">{hint}</span>}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={cn('border-t border-border p-4')}>
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
