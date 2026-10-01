import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateWorkspaceDialog } from '@/features/workspaces/CreateWorkspaceDialog';
import { useWorkspace } from '@/hooks/useAuth';
import { ROLE_LABEL } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';

export function WorkspaceSwitcher() {
  const { workspace, workspaces, setWorkspace } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover data-[state=open]:bg-hover"
          >
            <Avatar name={workspace.slug} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-4">{workspace.name}</span>
              <span className="block truncate text-xs text-subtle-foreground">
                {ROLE_LABEL[workspace.role]}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-subtle-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => {
                if (w.id === workspace.id) return;
                setWorkspace(w.id);
                // Everything cached belongs to the previous workspace.
                qc.removeQueries({ queryKey: ['ws'] });
                navigate('/dashboard');
              }}
            >
              <Avatar name={w.slug} size={18} />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === workspace.id && <Check className="!text-foreground" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
