#!/usr/bin/env node
// Дымовой тест офлайн-сборки AnOOPlan в настоящем Chromium.
// Проверяет: загрузку SPA без сервера, режим хранения «Браузер», загрузку PDF (pdf.js + worker),
// сохранение CSV через нативный мост AnOOPlanNative и отсутствие ошибок в консоли.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import PDFDocument from 'pdfkit';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('Нет dist/index.html — сначала выполните npm run build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${message}`);
  if (!ok) failures.push(message);
};

// Простой статический сервер, повторяющий логику нативного AssetServer:
// /api/* отвечает 404, поэтому приложение переключается в офлайн-режим «Браузер».
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"offline"}');
    return;
  }
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(DIST, path.replace(/^\/+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(DIST, 'index.html')));
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
console.log(`Статический сервер: ${baseUrl}`);

// Тестовый PDF-план: рамка и два «помещения» — как подложка чертежа.
const pdfPath = join(ROOT, 'build', 'smoke-plan.pdf');
await mkdir(join(ROOT, 'build'), { recursive: true });
await new Promise((done, fail) => {
  const doc = new PDFDocument({ size: [842, 595] });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  doc.on('end', () => writeFile(pdfPath, Buffer.concat(chunks)).then(done, fail));
  doc.rect(40, 40, 762, 515).stroke();
  doc.rect(80, 80, 300, 200).stroke();
  doc.rect(420, 80, 340, 200).stroke();
  doc.end();
});

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
await context.addInitScript(() => {
  window.__nativeSaves = [];
  window.AnOOPlanNative = {
    platform: () => 'android',
    saveFile: (name, base64, mime) => {
      window.__nativeSaves.push({ name, base64, mime });
      return 'ok:Download/AnOOPlan/' + name;
    },
  };
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => consoleErrors.push(String(error)));

console.log('\n1. Загрузка приложения');
await page.goto(baseUrl, { waitUntil: 'networkidle' });
check((await page.locator('.brand').innerText()).includes('AnOOPlan'), 'шапка показывает AnOOPlan');
check((await page.title()).includes('AnOOPlan'), 'заголовок страницы — AnOOPlan');
check(await page.locator('.plan-view').isVisible(), 'план отрисован');

console.log('\n2. Учебный проект и переключение режима на «Браузер»');
await page.locator('button:has-text("Учебный проект"):visible').first().click();
await page.waitForTimeout(500);
const projectName = await page.locator('input[aria-label="Название проекта"]').inputValue();
check(projectName.length > 0 && projectName !== 'Новый проект', `проект загружен: «${projectName}»`);
await page.locator('.view-tabs button:has-text("Журнал")').click();
await page.waitForTimeout(300);
check((await page.locator('.main-area').innerText()).toLowerCase().includes('кабельный журнал'), 'кабельный журнал доступен');
await page.locator('.view-tabs button:has-text("План")').click();

console.log('\n3. Сохранение проекта в браузере');
await page.locator('button:has-text("Сохранить")').first().click();
await page.waitForTimeout(600);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('cableplan:projects') || '[]').length >= 1), 'проект записан в localStorage');

console.log('\n4. Экспорт CSV через нативный мост');
await page.locator('summary:has-text("Экспорт")').click();
await page.locator('button:has-text("CSV"):visible').first().click();
await page.waitForTimeout(500);
const saved = await page.evaluate(() => window.__nativeSaves);
check(saved.length >= 1, 'мост AnOOPlanNative получил файл');
if (saved.length) {
  const text = Buffer.from(saved[0].base64, 'base64').toString('utf8');
  check(saved[0].name.endsWith('.csv'), `имя файла: ${saved[0].name}`);
  check(text.startsWith('\uFEFF'), 'CSV начинается с BOM');
  check(text.includes('Кабельный журнал'), 'CSV содержит кабельный журнал');
  check((await page.locator('.banner').first().innerText().catch(() => '')).includes('Download/AnOOPlan'), 'пользователю показан путь сохранения');
}

console.log('\n5. Загрузка PDF-плана (pdf.js + worker офлайн)');
await page.setInputFiles('input[type="file"][accept*="pdf"]', pdfPath);
await page.waitForTimeout(2500);
check(await page.locator('canvas').first().isVisible(), 'подложка PDF отрисована на canvas');
const bannerText = await page.locator('.banner').first().innerText().catch(() => '');
check(!bannerText.includes('Не удалось'), 'нет ошибки загрузки PDF');
check((await page.evaluate(() => JSON.parse(localStorage.getItem('cableplan:projects') || '[]').length)) >= 1, 'localStorage доступен');
const idbOk = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('cableplan', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return db.objectStoreNames.contains('pdfs');
});
check(idbOk, 'IndexedDB с PDF доступен');

console.log('\n6. Консоль браузера');
const realErrors = consoleErrors.filter(text => !/favicon|ERR_CONNECTION|404 \(Not Found\)/i.test(text));
check(realErrors.length === 0, realErrors.length ? `ошибки: ${realErrors.slice(0, 3).join(' | ')}` : 'ошибок нет');

await page.screenshot({ path: join(ROOT, 'build', 'smoke-phone.png') });
await browser.close();
server.close();

console.log(`\nИтог: ${failures.length ? 'ПРОВАЛ' : 'УСПЕХ'}`);
if (failures.length) {
  failures.forEach(item => console.log(' - ' + item));
  process.exit(1);
}
