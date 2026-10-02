import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import express, { type Router } from 'express';
import type { AppContext } from '../context';
import { buildOpenApi } from '../openapi/build';

const require = createRequire(import.meta.url);

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>goShort API</title>
<link rel="stylesheet" href="/docs/assets/swagger-ui.css">
</head><body><div id="swagger-ui"></div>
<script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/init.js"></script></body></html>`;

// External script so the default CSP (script-src 'self') applies unchanged: no inline script, no CDN.
const INIT = `window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: false, tryItOutEnabled: false });`;

/** `/openapi.json` and `/docs` (Swagger UI served from the bundled swagger-ui-dist; no external requests). */
export function docsRouter(ctx: AppContext): Router {
  const r = express.Router();
  const { document } = buildOpenApi(new URL(ctx.config.APP_URL).origin);
  const json = JSON.stringify(document);

  r.get('/openapi.json', (_req, res) => {
    res.type('application/json').set('Cache-Control', 'public, max-age=300').send(json);
  });
  r.get('/docs', (_req, res) => {
    res.type('html').set('Cache-Control', 'no-cache').send(PAGE);
  });
  r.get('/docs/assets/init.js', (_req, res) => {
    res.type('application/javascript').send(INIT);
  });
  // Serve ONLY the files the page needs (not the whole package: no package.json, source maps, etc.).
  const dist = dirname(require.resolve('swagger-ui-dist/package.json'));
  const ASSETS: Record<string, string> = {
    'swagger-ui.css': 'text/css',
    'swagger-ui-bundle.js': 'application/javascript',
    'favicon-32x32.png': 'image/png',
  };
  r.get('/docs/assets/:file', (req, res, next) => {
    const file = String(req.params.file);
    const type = ASSETS[file];
    if (!type) return next();
    res
      .type(type)
      .set('Cache-Control', 'public, max-age=86400')
      .sendFile(file, { root: dist, dotfiles: 'deny' });
  });
  return r;
}
