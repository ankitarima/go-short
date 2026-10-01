import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Link } from '@/types/api';

/** One-glance status: Active / Disabled / Expired, plus a lock when password protected. */
export function LinkStatus({ link }: { link: Link }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {!link.isActive ? (
        <Badge tone="gray" dot>
          Disabled
        </Badge>
      ) : link.expired ? (
        <Badge tone="amber" dot>
          Expired
        </Badge>
      ) : (
        <Badge tone="green" dot>
          Active
        </Badge>
      )}
      {link.hasPassword && (
        <Badge tone="outline" aria-label="Password protected" title="Password protected">
          <Lock className="size-3" />
        </Badge>
      )}
    </span>
  );
}
