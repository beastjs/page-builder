import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'bun run dev', url: 'http://127.0.0.1:5190', reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
