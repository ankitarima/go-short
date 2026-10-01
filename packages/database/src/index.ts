import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';

let client: PrismaClient | undefined;

/** Process-wide singleton. Pool size is controlled by DATABASE_POOL_MAX (default 10). */
export function getPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    const adapter = new PrismaPg({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
