/**
 * Minimal benchmark fixture: one workspace and a handful of links on the shared domain.
 * (The 100k-link load-test seeder lands with the k6 suite.)  Usage: npx tsx --env-file=.env scripts/seed-bench.ts
 */
import { disconnectPrisma, getPrisma } from '@go-short/database';

const prisma = getPrisma();
const host = (process.env.DEFAULT_SHORT_DOMAIN ?? 'localhost:4001').toLowerCase();

const user = await prisma.user.upsert({
  where: { email: 'bench@example.com' },
  create: { email: 'bench@example.com', name: 'bench', passwordHash: 'x' },
  update: {},
});
const ws =
  (await prisma.workspace.findUnique({ where: { slug: 'bench' } })) ??
  (await prisma.workspace.create({
    data: { name: 'bench', slug: 'bench', members: { create: { userId: user.id, role: 'OWNER' } } },
  }));
const domain = await prisma.domain.upsert({
  where: { hostname: host },
  create: {
    hostname: host,
    status: 'VERIFIED',
    isVerified: true,
    isDefault: true,
    verificationToken: 'shared',
  },
  update: {},
});
for (let i = 1; i <= 5; i++) {
  await prisma.link.upsert({
    where: { domainId_slug: { domainId: domain.id, slug: `bench${i}` } },
    create: {
      workspaceId: ws.id,
      domainId: domain.id,
      slug: `bench${i}`,
      destinationUrl: 'https://example.org/landing',
    },
    update: {},
  });
}
await disconnectPrisma();
console.log('seeded bench1..bench5 on', host);
