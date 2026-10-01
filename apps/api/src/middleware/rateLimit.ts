import { AppError } from '@go-short/shared';
import type { Request, RequestHandler } from 'express';
import type { AppContext } from '../context';

interface Options {
  name: string;
  limit: number;
  windowSeconds: number;
  key?: (req: Request) => string;
}

/**
 * Fixed-window counter in Redis (INCR + EXPIRE). Fails OPEN: if Redis is down we log and let the
 * request through rather than turning a cache outage into an auth outage.
 */
export const rateLimit =
  (ctx: AppContext, o: Options): RequestHandler =>
  async (req, res, next) => {
    const id = o.key ? o.key(req) : (req.ip ?? 'unknown');
    const key = `rl:${o.name}:${id}`;
    try {
      const [[, count]] = (await ctx.redis
        .multi()
        .incr(key)
        .expire(key, o.windowSeconds, 'NX')
        .exec()) as [[Error | null, number], unknown];
      res.setHeader('RateLimit-Limit', o.limit);
      res.setHeader('RateLimit-Remaining', Math.max(0, o.limit - count));
      if (count > o.limit) {
        res.setHeader('Retry-After', o.windowSeconds);
        throw new AppError('RATE_LIMITED', 'Too many requests, please try again later');
      }
    } catch (err) {
      if (err instanceof AppError) return next(err);
      req.log.error({ err }, 'rate limiter unavailable, failing open');
    }
    next();
  };
