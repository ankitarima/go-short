import { execSync } from 'node:child_process';
import pg from 'pg';

export default async function setup() {
  const admin = new pg.Client({
    connectionString: 'postgresql://goshort:goshort@localhost:5432/postgres',
  });
  await admin.connect();
  const { rowCount } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'goshort_test'",
  );
  if (!rowCount) await admin.query('CREATE DATABASE goshort_test');
  await admin.end();
  execSync('npx prisma migrate deploy', {
    cwd: '../packages/database',
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://goshort:goshort@localhost:5432/goshort_test',
    },
    stdio: 'pipe',
  });
}
