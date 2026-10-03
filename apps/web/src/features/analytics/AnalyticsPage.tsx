import { PageHeader } from '@go-short/ui/components/page-header';
import { AnalyticsView } from './AnalyticsView';

export function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Clicks, visitors, locations, devices, referrers and campaign sources across your workspace."
      />
      <AnalyticsView scope={{ kind: 'workspace' }} showScopeFilters />
    </>
  );
}
