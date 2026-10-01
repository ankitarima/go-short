import { Router } from 'express';
import type { AppContext } from '../context';

export function healthRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Readiness reports only pass/fail per dependency; no hostnames, versions or error text.
  r.get('/ready', async (req, res) => {
    const check = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return 'ok';
      } catch (err) {
        req.log.error({ err }, 'readiness check failed');
        return 'fail';
      }
    };
    const [postgres, redis] = await Promise.all([
      check(() => ctx.prisma.$queryRaw`SELECT 1`),
      check(() => ctx.redis.ping()),
    ]);
    const ready = postgres === 'ok' && redis === 'ok';
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? 'ready' : 'unavailable', checks: { postgres, redis } });
  });
  return r;
}
