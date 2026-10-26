import { defineConfig, devices } from '@playwright/test';

// Визуальные эталоны UI. Отдельный конфиг, чтобы `npm run test:ui` (2 E2E в CI)
// не зависел от шрифтов раннера: эталоны снимаются и проверяются на одной машине.
// Обновление после осознанного изменения UI: npm run test:visual:update
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: 'light',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    },
  }],
});
