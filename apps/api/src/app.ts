import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { loadSession, requireApiKey } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { adminRouter } from './routes/admin';
import { analyticsRouter } from './routes/analytics';
import { authRouter } from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { docsRouter } from './routes/docs';
import { domainsRouter } from './routes/domains';
import { linksRouter } from './routes/links';
import { qrRouter } from './routes/qr';
import { healthRouter } from './routes/health';
import { internalRouter } from './routes/internal';
import { meRouter } from './routes/me';
import { workspacesRouter } from './routes/workspaces';
import './types';

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-* from configured proxies (see docs/security.md). Never `true`.
  app.set('trust proxy', ctx.config.trustProxy);

  app.use((req, res, next) => {
    req.requestId = `req_${randomUUID()}`;
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => (req as express.Request).requestId,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      // Path only: query strings can carry tokens (e.g. reset links) and must not be logged.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: ctx.config.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(healthRouter(ctx));
  app.use('/internal', internalRouter(ctx));
  app.use(docsRouter(ctx));

  const v1 = express.Router();
  v1.use(loadSession(ctx));
  v1.use('/auth', authRouter(ctx));
  v1.use('/me', meRouter(ctx));
  v1.use('/workspaces', workspacesRouter(ctx));
  v1.use('/admin', adminRouter(ctx));

  // Flat, API-key-only routes (`/api/v1/links`, ...). The workspace is the key's own, never a client claim;
  // the same routers and permission checks as the nested routes are used, with the key's role.
  const flat = express.Router();
  // requireApiKey is per mount (not on the whole router) so unknown paths still return 404.
  flat.use('/domains', requireApiKey, domainsRouter(ctx));
  flat.use('/links', requireApiKey, linksRouter(ctx));
  flat.use('/campaigns', requireApiKey, campaignsRouter(ctx));
  flat.use('/qr', requireApiKey, qrRouter(ctx));
  flat.use('/analytics', requireApiKey, analyticsRouter(ctx));
  v1.use(flat);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(ctx));
  return app;
}
