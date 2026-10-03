import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[var(--overlay)]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col rounded-xl bg-background shadow-menu',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-md p-1 text-subtle-foreground hover:bg-hover hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogHeader = ({ className, ...p }: ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1 px-6 pt-6', className)} {...p} />
);
export const DialogBody = ({ className, ...p }: ComponentProps<'div'>) => (
  <div className={cn('overflow-y-auto px-6 py-5', className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: ComponentProps<'div'>) => (
  <div
    className={cn(
      'flex flex-col-reverse gap-2 rounded-b-xl border-t border-border bg-surface px-6 py-3 sm:flex-row sm:justify-end',
      className,
    )}
    {...p}
  />
);
export const DialogTitle = ({ className, ...p }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn('heading-20 pr-6', className)} {...p} />
);
export const DialogDescription = ({
  className,
  ...p
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn('copy-14 text-muted-foreground', className)} {...p} />
);

/** Confirmation for destructive actions. */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <div className="h-5" />
        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={props.destructive === false ? 'primary' : 'destructive'}
            loading={props.loading}
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
