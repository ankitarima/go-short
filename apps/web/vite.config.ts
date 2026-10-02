import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { SECURITY_HEADERS } from './security-headers';

const api = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

// Same-origin in dev, exactly like production behind Caddy: the session cookie just works.
const proxy = {
  // `^/api/` (with the slash): a bare '/api' prefix would also swallow the SPA route '/api-keys'.
  '^/api/': api,
  '/docs': api,
  '/openapi.json': api,
  '/health': api,
  '/ready': api,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy },
  // `npm run preview` serves the production build with the production security headers.
  preview: { port: 4173, proxy, headers: SECURITY_HEADERS },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
