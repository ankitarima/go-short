/** Events a workspace can subscribe to. `analytics.threshold` is reserved for a later release. */
export const WEBHOOK_EVENTS = [
  'link.created',
  'link.updated',
  'link.deleted',
  'campaign.created',
  'domain.verified',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Delivered to every active webhook regardless of subscription when a user clicks "send test event". */
export const WEBHOOK_TEST_EVENT = 'webhook.test' as const;

export interface WebhookJob {
  webhookId: string;
  deliveryId: string;
  type: WebhookEventType | typeof WEBHOOK_TEST_EVENT;
  workspaceId: string;
  createdAt: string; // ISO
  data: Record<string, unknown>;
}

/** Retries with exponential backoff (5 s, 10 s, 20 s, 40 s, 80 s), then kept for inspection. */
export const WEBHOOK_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 10_000 },
};
