import { defineConfig, devices } from '@playwright/test';

/**
 * Замеры производительности в реальном Chromium на production-сборке.
 *
 * Отдельный конфиг, чтобы perf-тесты не попадали в `npm test`/`test:ui`:
 * они требовательны ко времени и к тишине в системе (фоновые сборки и E2E
 * искажают кадры). Запуск:
 *
 *   npx playwright test --config playwright.perf.config.ts
 *
 * Порт можно переопределить: PERF_PORT=4185 npx playwright test --config ... —
 * на машине разработчика 4175 может занять системный preview клиента.
 */
const PORT = Number(process.env.PERF_PORT ?? 4175);

export default defineConfig({
  testDir: './tests/perf',
  // Один воркер: два Chromium на одной машине делят CPU и портят медианы.
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    // Свой preview на время замера: чужой сервер может умереть посреди прогона.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
