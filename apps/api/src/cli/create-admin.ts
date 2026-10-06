/**
 * Creates a platform super admin (or promotes an existing account) from inside the deployment.
 * Runs in the api container, which already has DATABASE_URL:
 *
 *   ADMIN_PASSWORD='a long passphrase' node dist/cli/create-admin.js you@example.com "Your Name" [--role ADMIN]
 *
 * The password comes from the environment, never an argument, so it does not appear in the process list.
 * An existing account is promoted and its password is left alone. Later staff are added in the console.
 */
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { registerSchema } from '@go-short/validation';
import { hashPassword } from '../lib/password';

const ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;
type Role = (typeof ROLES)[number];

const args = process.argv.slice(2);
const roleAt = args.indexOf('--role');
const roleArg = roleAt >= 0 ? args[roleAt + 1] : undefined;
const [emailArg, nameArg] = roleAt >= 0 ? args.slice(0, roleAt) : args;

if (roleAt >= 0 && !ROLES.includes(roleArg as Role)) {
  fail('--role must be MANAGER, ADMIN or SUPER_ADMIN');
}
if (!emailArg) {
  fail('Usage: ADMIN_PASSWORD=... node dist/cli/create-admin.js <email> "<name>" [--role ROLE]');
}
const role: Role = (roleArg as Role | undefined) ?? 'SUPER_ADMIN';

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const prisma = getPrisma();
try {
  const email = emailArg!.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  let userId: string;
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { systemRole: role } });
    userId = existing.id;
    console.log(`${email} already existed: now ${role}. Its password was not changed.`);
  } else {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) fail('Set ADMIN_PASSWORD (the new account needs a password).');
    const input = registerSchema.safeParse({ email, name: nameArg ?? 'Platform admin', password });
    if (!input.success) {
      fail(
        `Invalid input: ${input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    const user = await prisma.user.create({
      data: {
        email: input.data.email,
        name: input.data.name,
        passwordHash: await hashPassword(input.data.password),
        emailVerified: true,
        systemRole: role,
      },
    });
    userId = user.id;
    console.log(`Created ${user.email} as ${role}. Sign in at /console.`);
  }
  await prisma.auditLog.create({
    data: {
      action: 'ADMIN_ROLE_SET_BY_CLI',
      resourceType: 'user',
      resourceId: userId,
      metadata: { systemRole: role },
    },
  });
} finally {
  await disconnectPrisma();
}
