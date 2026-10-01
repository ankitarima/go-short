import {
  BarChart3,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Power,
  QrCode,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/hooks/useAuth';
import type { Link } from '@/types/api';

export function LinkRowActions({
  link,
  onEdit,
  onDelete,
  onToggle,
}: {
  link: Link;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { canWrite } = useWorkspace();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${link.slug}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(link.shortUrl);
            toast.success('Short link copied');
          }}
        >
          <Copy /> Copy short link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open(link.shortUrl, '_blank', 'noopener')}>
          <ExternalLink /> Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/links/${link.id}`)}>
          <BarChart3 /> Analytics
        </DropdownMenuItem>
        {canWrite && (
          <>
            <DropdownMenuItem onSelect={() => navigate(`/qr/new?linkId=${link.id}`)}>
              <QrCode /> Generate QR code
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggle}>
              <Power /> {link.isActive ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
