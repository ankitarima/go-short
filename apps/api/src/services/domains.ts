import { AppError } from '@go-short/shared';
import type { Domain } from '@go-short/database';
import type { AppContext } from '../context';
import { VERIFY_TXT_PREFIX } from './dns';

/** Hostname without a port: what DNS (and a customer's CNAME) deals in. */
export const hostOnly = (hostname: string): string => hostname.split(':')[0]!.toLowerCase();

/**
 * First-boot seed. The shared short domains live in the database and are managed from the console;
 * DEFAULT_SHORT_DOMAIN only provides the first one when there is none yet. It never re-creates,
 * re-enables or re-defaults anything afterwards, so a restart cannot undo what an admin configured.
 */
export async function ensureSharedDomain(ctx: AppContext): Promise<void> {
  if ((await ctx.prisma.domain.count({ where: { workspaceId: null } })) > 0) return;
  const hostname = ctx.config.DEFAULT_SHORT_DOMAIN.toLowerCase();
  const existing = await ctx.prisma.domain.findUnique({ where: { hostname } });
  if (existing) {
    throw new Error(
      `DEFAULT_SHORT_DOMAIN ${hostname} is already claimed by a workspace; resolve before starting`,
    );
  }
  await ctx.prisma.domain.create({
    data: {
      hostname,
      workspaceId: null,
      status: 'VERIFIED',
      isVerified: true,
      isDefault: true,
      verificationToken: 'shared',
    },
  });
}

/** Usable shared domains, the default first. */
export const listActiveShared = (ctx: AppContext): Promise<Domain[]> =>
  ctx.prisma.domain.findMany({
    where: { workspaceId: null, status: 'VERIFIED' },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

/**
 * What customers CNAME their own domains to: the default shared domain (the environment value only
 * if the database has none). `accepted` is every active shared host, so a domain pointed at an older
 * shared domain still verifies after the default changes.
 */
export async function cnameTargets(
  ctx: AppContext,
): Promise<{ primary: string; accepted: string[] }> {
  const active = await listActiveShared(ctx);
  const hosts = [...new Set(active.map((d) => hostOnly(d.hostname)))];
  if (hosts.length === 0) hosts.push(hostOnly(ctx.config.DEFAULT_SHORT_DOMAIN));
  return { primary: hosts[0]!, accepted: hosts };
}

/**
 * Hostnames that must never be claimable: the app itself and the configured seed domain. Shared domains
 * added in the console are protected by the unique hostname constraint instead.
 */
export function reservedHostnames(ctx: AppContext): Set<string> {
  const names = new Set<string>([
    ctx.config.DEFAULT_SHORT_DOMAIN.toLowerCase(),
    hostOnly(ctx.config.DEFAULT_SHORT_DOMAIN),
  ]);
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

export function domainDto(d: Domain, cname: string) {
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
          cname: { type: 'CNAME', name: d.hostname, value: cname },
          txt: {
            type: 'TXT',
            name: `${VERIFY_TXT_PREFIX}.${d.hostname}`,
            value: d.verificationToken,
          },
        },
  };
}

/**
 * Releases hostnames claimed but never verified, so a squatter cannot hold a name forever.
 * Verified domains are never touched. Wired into the BullMQ cleanup queue.
 */
export async function deleteStalePendingDomains(
  ctx: AppContext,
  olderThanDays = 7,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await ctx.prisma.domain.deleteMany({
    where: {
      workspaceId: { not: null },
      isVerified: false,
      status: 'PENDING',
      createdAt: { lt: cutoff },
      links: { none: {} },
    },
  });
  return count;
}
