import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // SDK from source, as in tests/ (also for tests/helpers.ts, which this suite reuses).
    alias: [
      {
        find: /^@opaq\/sdk\/confidential$/,
        replacement: fileURLToPath(new URL('../../packages/sdk/src/confidential.ts', import.meta.url)),
      },
      { find: /^@opaq\/sdk$/, replacement: fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
