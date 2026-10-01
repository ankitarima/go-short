/**
 * Grants (or with --revoke, removes) the platform-admin role. There is deliberately no sign-up or
 * environment-variable shortcut: becoming an admin requires shell access to the deployment.
 *
 *   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com
 *   npx tsx --env-file=.env scripts/grant-admin.ts you@example.com --revoke
 */
import { disconnectPrisma, getPrisma } from '@go-short/database';

const [email, flag] = process.argv.slice(2);
if (!email || email.startsWith('--')) {
  console.error('Usage: grant-admin.ts <email> [--revoke]');
  process.exit(2);
}
const prisma = getPrisma();
const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
if (!user) {
  console.error(`No user with email ${email}. Register first, then run this again.`);
  await disconnectPrisma();
  process.exit(1);
}
const systemRole = flag === '--revoke' ? 'USER' : 'ADMIN';
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
