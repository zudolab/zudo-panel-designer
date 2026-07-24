// Scoped so `pnpm -F @zpd/app test` runs only this package's unit tests. The
// root vitest.config.ts (repo root `pnpm test`, which CI runs) still covers
// every package via its own workspace-wide include glob — this file doesn't
// affect that. `e2e/**` is excluded so a bare `vitest run <pattern>` never
// picks up the Playwright specs (they share names with unit files, e.g.
// svg-import), which would otherwise fail with a test.describe() mismatch.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
