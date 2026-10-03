import { useWorkspace, wsPath } from '@/hooks/useAuth';
import { apiUrl } from '@/lib/api';
import { cn } from '@go-short/ui/lib/cn';
import type { Qr } from '@/types/api';

/** Saved QR code image, rendered by the API on demand (cookie-authenticated, same origin). */
export function QrThumb({
  qr,
  size = 256,
  className,
}: {
  qr: Qr;
  size?: number;
  className?: string;
}) {
  const { workspace } = useWorkspace();
  const src = apiUrl(wsPath(workspace, `/qr/${qr.id}/image`), {
    format: 'png',
    size,
    v: qr.updatedAt,
  });
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2',
        className,
      )}
    >
      <img
        src={src}
        alt={`QR code for ${qr.name}`}
        loading="lazy"
        width={size}
        height={size}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
