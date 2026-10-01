import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '@/hooks/useAuth';
import { AuditLogPanel } from './AuditLogPanel';
import { GeneralPanel } from './GeneralPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { SecurityPanel } from './SecurityPanel';
import { WebhooksPanel } from './WebhooksPanel';

export function SettingsPage() {
  const { canManage } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration, privacy and your account."
      />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          {canManage && <TabsTrigger value="webhooks">Webhooks</TabsTrigger>}
          {canManage && <TabsTrigger value="audit">Audit log</TabsTrigger>}
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralPanel />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacyPanel />
        </TabsContent>
        {canManage && (
          <TabsContent value="webhooks">
            <WebhooksPanel />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="audit">
            <AuditLogPanel />
          </TabsContent>
        )}
        <TabsContent value="security">
          <SecurityPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
