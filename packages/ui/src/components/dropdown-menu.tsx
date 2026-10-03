import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-48 animate-pop-in rounded-lg bg-background p-1 shadow-menu',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-red [&_svg]:text-red data-[highlighted]:bg-red-soft',
        className,
      )}
      {...props}
    />
  );
}
export const DropdownMenuLabel = ({
  className,
  ...p
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) => (
  <DropdownMenuPrimitive.Label
    className={cn('px-3 py-1.5 text-xs text-subtle-foreground', className)}
    {...p}
  />
);
export const DropdownMenuSeparator = ({
  className,
  ...p
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...p} />
);
