import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5191', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'bun run build && bun scripts/serve-browser-tests.ts', url: 'http://127.0.0.1:5191', reuseExistingServer: false, timeout: 60_000 },
})
