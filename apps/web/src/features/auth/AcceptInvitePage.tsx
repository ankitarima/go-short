import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ME_KEY, useMeQuery } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { AuthLayout } from './AuthLayout';

export function AcceptInvitePage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const me = useMeQuery();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setActive = useUi((s) => s.setActiveWorkspace);

  const accept = useMutation({
    mutationFn: () =>
      api<{ workspaceId: string }>('/workspaces/invitations/accept', {
        method: 'POST',
        body: { token },
      }),
    onSuccess: async (r) => {
      setActive(r.workspaceId);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success('You joined the workspace');
      navigate('/dashboard', { replace: true });
    },
  });

  const next = `/accept-invite?token=${encodeURIComponent(token)}`;
  return (
    <AuthLayout title="Join a workspace" description="You were invited to collaborate on goShort.">
      {!token ? (
        <Callout tone="danger" title="This invitation link is incomplete" />
      ) : me.isPending ? null : !me.data ? (
        <div className="flex flex-col gap-3">
          <p className="copy-14 text-center text-muted-foreground">
            Sign in with the email address that received the invitation to accept it.
          </p>
          <Button asChild>
            <Link to="/login" state={{ from: next }}>
              Log in
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/register" state={{ from: next }}>
              Create an account
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {accept.error instanceof ApiError && (
            <Callout tone="danger" title="Could not accept the invitation">
              {accept.error.message} Make sure you are signed in as the invited email address.
            </Callout>
          )}
          <p className="copy-14 text-center text-muted-foreground">
            Signed in as <span className="text-foreground">{me.data.user.email}</span>
          </p>
          <Button loading={accept.isPending} onClick={() => accept.mutate()}>
            Accept invitation
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
