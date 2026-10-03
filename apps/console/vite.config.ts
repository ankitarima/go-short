import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_API_PROXY ?? 'http://localhost:4000';
// Same-origin in dev too: the console reuses the session cookie the app signs in with.
const proxy = { '^/api/': api, '/openapi.json': api };

export default defineConfig({
  // The console is served under /console on the app's own domain (see docker/caddy/Caddyfile).
  base: '/console/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // strictPort: this port is an internal detail; the web dev server proxies /console to it (open :5173/console/).
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 4174, proxy },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
