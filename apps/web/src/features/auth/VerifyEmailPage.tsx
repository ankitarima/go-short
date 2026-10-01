import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/skeleton';
import { ME_KEY } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['verify-email', token],
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      await api('/auth/verify-email', { method: 'POST', body: { token }, public: true });
      void qc.invalidateQueries({ queryKey: ME_KEY });
      return true;
    },
  });
  return (
    <AuthLayout title="Verify your email">
      {!token ? (
        <Callout tone="danger" title="This verification link is incomplete" />
      ) : q.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner className="size-5" />
        </div>
      ) : q.isError ? (
        <Callout tone="danger" title="Could not verify your email">
          {q.error instanceof ApiError ? q.error.message : 'Try the link again.'}
        </Callout>
      ) : (
        <div className="flex flex-col gap-4">
          <Callout tone="info" title="Email verified">
            Thanks, your email address is confirmed.
          </Callout>
          <Button asChild>
            <Link to="/dashboard">Continue to dashboard</Link>
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
