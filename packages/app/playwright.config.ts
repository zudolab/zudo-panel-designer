// Wave 6 (#13) smoke suite config. webServer builds + serves the PRODUCTION
// bundle (not `vite dev`) so the suite exercises what actually ships — see
// the "Production Build Verification" pattern in zudo-test-wisdom's
// playwright-patterns doc. Port 15300: 15100/15200 are already in use by
// other worktrees/processes in this repo.
import { defineConfig, devices } from '@playwright/test';

const PORT = 15300;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI also writes an HTML report (uploaded as an artifact on failure by
  // pr-checks.yml); local runs stick to the terminal list reporter.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
