import { defineConfig } from 'tsup';

// Workspace packages ship as TypeScript source, so they must be bundled rather than externalized.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: [/^@go-short\//],
});
