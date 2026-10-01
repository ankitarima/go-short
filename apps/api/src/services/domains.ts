import { AppError } from '@go-short/shared';
import type { Domain } from '@go-short/database';
import type { AppContext } from '../context';
import { VERIFY_TXT_PREFIX } from './dns';

/** Platform-shared default short domain: workspaceId null, always verified. Idempotent. */
export async function ensureSharedDomain(ctx: AppContext): Promise<void> {
  const hostname = ctx.config.DEFAULT_SHORT_DOMAIN.toLowerCase();
  const existing = await ctx.prisma.domain.findUnique({ where: { hostname } });
  if (existing && existing.workspaceId !== null) {
    throw new Error(
      `DEFAULT_SHORT_DOMAIN ${hostname} is already claimed by a workspace; resolve before starting`,
    );
  }
  await ctx.prisma.domain.upsert({
    where: { hostname },
    create: {
      hostname,
      workspaceId: null,
      status: 'VERIFIED',
      isVerified: true,
      isDefault: true,
      verificationToken: 'shared',
    },
    update: { status: 'VERIFIED', isVerified: true },
  });
}

/** Host part (no port) of the CNAME target customers must point at. */
export const cnameTarget = (ctx: AppContext): string =>
  ctx.config.DEFAULT_SHORT_DOMAIN.split(':')[0]!.toLowerCase();

/** Hostnames that must never be claimable: the app itself and the shared short domain. */
export function reservedHostnames(ctx: AppContext): Set<string> {
  const names = new Set<string>([ctx.config.DEFAULT_SHORT_DOMAIN.toLowerCase(), cnameTarget(ctx)]);
  try {
    names.add(new URL(ctx.config.APP_URL).hostname.toLowerCase());
  } catch {
    /* validated at config load */
  }
  return names;
}

/** A domain a workspace may attach links to: its own or the shared one, verified, not disabled. */
export async function requireUsableDomain(
  ctx: AppContext,
  workspaceId: string,
  domainId: string,
): Promise<Domain> {
  const domain = await ctx.prisma.domain.findFirst({
    where: { id: domainId, OR: [{ workspaceId }, { workspaceId: null }] },
  });
  if (!domain) throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found');
  if (domain.status !== 'VERIFIED')
    throw new AppError('DOMAIN_NOT_USABLE', 'Domain is not verified or is disabled');
  return domain;
}

export function domainDto(ctx: AppContext, d: Domain) {
  const shared = d.workspaceId === null;
  return {
    id: d.id,
    hostname: d.hostname,
    status: d.status,
    isVerified: d.isVerified,
    isDefault: d.isDefault,
    shared,
    createdAt: d.createdAt,
    // DNS instructions are only meaningful (and only shown) for workspace-owned domains.
    dns: shared
      ? null
      : {
          cname: { type: 'CNAME', name: d.hostname, value: cnameTarget(ctx) },
          txt: {
            type: 'TXT',
            name: `${VERIFY_TXT_PREFIX}.${d.hostname}`,
            value: d.verificationToken,
          },
        },
  };
}
