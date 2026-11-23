#!/usr/bin/env node
// Скриншоты релиза: демо-проект, полевой режим, экран «О программе».
// Запуск: node dsh/release-screenshots.mjs  →  build/release-screenshots/*.png
// Скрипт в APK не входит (в сборку попадает только dist/).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'build', 'release-screenshots');
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
});

const waitServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('vite preview не поднялся за 60 с');
};

try {
  await waitServer();
  const browser = await chromium.launch();

  // 1. План демо-проекта (десктопный вид).
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(URL);
  await desktop.locator('.statusbar').filter({ hasText: 'БРАУЗЕР' }).first().waitFor({ timeout: 30_000 });
  await desktop.getByRole('button', { name: 'Учебный проект' }).first().click();
  await desktop.locator('[data-object="segment"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await desktop.waitForTimeout(1500);
  await desktop.screenshot({ path: join(OUT, '01-plan.png') });

  // 2. Полевой режим (телефон, тёмная «уличная» тема, нижняя панель).
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(URL);
  await mobile.locator('.statusbar').filter({ hasText: 'БРАУЗЕР' }).first().waitFor({ timeout: 30_000 });
  // На телефоне сайдбар скрыт за кнопкой «☰ Меню».
  const menu = mobile.getByRole('button', { name: 'Меню' });
  await menu.click();
  await mobile.getByRole('button', { name: 'Учебный проект' }).first().click();
  await mobile.locator('[data-object="segment"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await menu.click();
  await mobile.getByRole('button', { name: /Полевой режим/ }).first().click();
  await mobile.keyboard.press('Escape');
  await mobile.waitForTimeout(1200);
  await mobile.screenshot({ path: join(OUT, '02-field-mode.png') });

  // 3. Экран «О программе» с диагностикой.
  await menu.click();
  await mobile.getByRole('button', { name: /О программе/ }).first().click();
  await mobile.locator('.runtime-info').waitFor({ timeout: 15_000 });
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: join(OUT, '03-about.png') });

  await browser.close();
  console.log(`Скриншоты: ${OUT}`);
} finally {
  server.kill();
}
