/**
 * Bootstraps platform staff for the console. Grants a platform role (default SUPER_ADMIN), or with
 * --revoke removes it. There is deliberately no sign-up or environment-variable shortcut: the first
 * super admin requires shell access to the deployment. After that, super admins add managers, admins
 * and other super admins from the console itself.
 *
 *   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com
 *   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com --role ADMIN
 *   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com --revoke
 */
import { disconnectPrisma, getPrisma } from '@go-short/database';

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');
const roleFlag = flags[flags.indexOf('--role') + 1];
const ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;
if (flags.includes('--role') && !ROLES.includes(roleFlag as (typeof ROLES)[number])) {
  console.error('--role must be MANAGER, ADMIN or SUPER_ADMIN');
  process.exit(2);
}
if (!email || email.startsWith('--')) {
  console.error('Usage: grant-admin.ts <email> [--role MANAGER|ADMIN|SUPER_ADMIN] [--revoke]');
  process.exit(2);
}
const prisma = getPrisma();
const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
if (!user) {
  console.error(`No user with email ${email}. Register first, then run this again.`);
  await disconnectPrisma();
  process.exit(1);
}
const systemRole = revoke
  ? 'USER'
  : ((roleFlag as (typeof ROLES)[number] | undefined) ?? 'SUPER_ADMIN');
await prisma.user.update({ where: { id: user.id }, data: { systemRole } });
await prisma.auditLog.create({
  data: {
    action: 'ADMIN_ROLE_SET_BY_CLI',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { systemRole },
  },
});
console.log(`${user.email} is now ${systemRole}.`);
await disconnectPrisma();
