import { useQuery } from '@tanstack/react-query';
import { fetchSpec } from './lib/openapi';

/** The API description, fetched once per visit. Public: no sign-in needed. */
export function useSpec() {
  return useQuery({
    queryKey: ['docs', 'openapi'],
    queryFn: fetchSpec,
    staleTime: Infinity,
  });
}
