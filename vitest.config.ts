import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '_temp-resource/**', 'worktrees/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
