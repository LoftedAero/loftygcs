import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4173', actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node scripts/pwa-test-server.mjs',
    port: 4173,
    reuseExistingServer: false,
  },
})
