import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test the SDK from source so `pnpm build` is not a prerequisite.
    alias: { '@opaq/sdk': fileURLToPath(new URL('../packages/sdk/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Each file starts its own surfnet; keep them serial.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
