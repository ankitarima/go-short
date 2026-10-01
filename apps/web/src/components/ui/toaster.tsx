import { Toaster as Sonner } from 'sonner';
import { useUi } from '@/stores/ui';

export function Toaster() {
  const theme = useUi((s) => s.resolvedTheme);
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            '!rounded-lg !border !border-border !bg-background !text-foreground !shadow-menu !font-sans',
          description: '!text-muted-foreground',
        },
      }}
    />
  );
}
