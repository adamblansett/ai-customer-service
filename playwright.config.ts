import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start --workspace=@customer-service/api',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '3001',
        DATABASE_URL: '',
        CORS_ORIGIN: 'http://localhost:3000',
        JWT_SECRET: 'e2e-test-jwt-secret-32-chars-minimum!',
        ENCRYPTION_MASTER_KEY: 'e2e-test-master-key-32bytes-long!!',
      },
    },
    {
      command: 'npm run start --workspace=@customer-service/web',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: '3000',
        INTERNAL_API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001/api/v1',
      },
    },
  ],
});
