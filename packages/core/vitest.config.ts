// Scoped so `pnpm -F @zpd/core test` runs only this package's tests. The
// root vitest.config.ts (repo root `pnpm test`) still covers every package
// via its own workspace-wide include glob — this file doesn't affect that.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
});
