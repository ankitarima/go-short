import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./globalSetup.ts'],
    setupFiles: ['./env.ts'],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
