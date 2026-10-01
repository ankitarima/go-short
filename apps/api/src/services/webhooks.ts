import { randomUUID } from 'node:crypto';
import { WEBHOOK_JOB_OPTIONS, type WebhookEventType, type WebhookJob } from '@go-short/shared';
import type { AppContext } from '../context';

/**
 * Queues a delivery for every active webhook of the workspace subscribed to `type`.
 * Never throws and never fails the caller's request: webhooks are best-effort notifications,
 * and a mutation that already committed must not report an error because a queue is down.
 */
export async function emitWebhook(
  ctx: AppContext,
  workspaceId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await ctx.prisma.webhook.findMany({
      where: { workspaceId, isActive: true, events: { has: type } },
      select: { id: true },
    });
    const createdAt = new Date().toISOString();
    for (const h of hooks) {
      const deliveryId = `del_${randomUUID()}`;
      const job: WebhookJob = { webhookId: h.id, deliveryId, type, workspaceId, createdAt, data };
      await ctx.queues.webhooks.add('delivery', job, { ...WEBHOOK_JOB_OPTIONS, jobId: deliveryId });
    }
  } catch (err) {
    ctx.logger.error({ err, type, workspaceId }, 'could not queue webhook deliveries');
  }
}
