import { normalizeHostname } from '@go-short/shared';
import { Router } from 'express';
import type { AppContext } from '../context';
import { safeEqual } from '../lib/crypto';

/**
 * Caddy on-demand TLS "ask" endpoint: `GET /internal/tls-check?domain=<host>&token=<secret>`.
 * 200 only for hostnames that are the shared domain or a VERIFIED custom domain, so arbitrary Host
 * headers cannot make Caddy request certificates (rate-limit / abuse protection). Must not be
 * routed publicly by the reverse proxy; the token is a second layer in case it is.
 */
export function internalRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/tls-check', async (req, res) => {
    const expected = ctx.config.INTERNAL_API_TOKEN;
    const given = typeof req.query.token === 'string' ? req.query.token : '';
    if (expected && !safeEqual(given, expected)) return void res.status(403).end();

    const raw = typeof req.query.domain === 'string' ? req.query.domain.toLowerCase() : '';
    // The exact string covers shared domains with a port (local dev); the normalised form covers the rest.
    const candidates = [...new Set([raw, normalizeHostname(raw)].filter((h): h is string => !!h))];
    if (candidates.length === 0) return void res.status(404).end();
    const d = await ctx.prisma.domain.findFirst({
      where: { hostname: { in: candidates } },
      select: { status: true },
    });
    res.status(d?.status === 'VERIFIED' ? 200 : 404).end();
  });
  return r;
}
