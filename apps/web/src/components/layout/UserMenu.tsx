import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Settings, Shield, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@go-short/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@go-short/ui/components/dropdown-menu';
import { useWorkspace } from '@/hooks/useAuth';
import { api, setCsrfToken } from '@/lib/api';

export function UserMenu() {
  const { me } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover data-[state=open]:bg-hover"
        >
          <Avatar name={me.user.email} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-4">{me.user.name}</span>
            <span className="block truncate text-xs text-subtle-foreground">{me.user.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{me.user.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/settings?tab=security')}>
          <User /> Profile & security
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings /> Settings
        </DropdownMenuItem>
        {me.user.systemRole === 'ADMIN' && (
          <DropdownMenuItem onSelect={() => navigate('/admin')}>
            <Shield /> Platform admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
