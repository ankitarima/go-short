import type { Prisma } from '@go-short/database';
import type { AppContext } from '../context';

export interface AuditEntry {
  workspaceId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  /** Must never contain secrets (passwords, tokens, API keys). */
  metadata?: Prisma.InputJsonValue;
}

/** Audit failures are logged, not thrown: a logging fault must not undo a completed action. */
export async function audit(ctx: AppContext, e: AuditEntry): Promise<void> {
  try {
    await ctx.prisma.auditLog.create({ data: e });
  } catch (err) {
    ctx.logger.error({ err, action: e.action }, 'failed to write audit log');
  }
}
