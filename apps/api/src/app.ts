import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { loadSession } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
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

  const v1 = express.Router();
  v1.use(loadSession(ctx));
  v1.use('/auth', authRouter(ctx));
  v1.use('/me', meRouter(ctx));
  v1.use('/workspaces', workspacesRouter(ctx));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(ctx));
  return app;
}
