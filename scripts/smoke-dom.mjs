#!/usr/bin/env node
// Дымовой тест веб-приложения без браузера: сборка бандла, DOM-эмуляция (happy-dom).
// Проверяет загрузку интерфейса, офлайн-режим «Браузер», localStorage и сохранение CSV
// через нативный мост AnOOPlanNative (тот же путь, что в APK).
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'build');
await mkdir(OUT, { recursive: true });

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${message}`);
  if (!ok) failures.push(message);
};

console.log('1. Сборка тестового бандла (esbuild)');
const bundleFile = join(OUT, 'smoke-app.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: bundleFile,
  logLevel: 'error',
  loader: { '.css': 'empty' },
  external: ['pdfjs-dist', 'pdfjs-dist/*'],
  plugins: [{
    // Vite-специфичный импорт `?url` заменяем на путь ассета.
    name: 'url-suffix',
    setup(b) {
      b.onResolve({ filter: /\?url$/ }, args => ({ path: args.path.replace(/\?url$/, ''), namespace: 'url-suffix' }));
      b.onLoad({ filter: /.*/, namespace: 'url-suffix' }, args => {
        const base = args.path.split('/').pop();
        return { contents: `export default "/assets/${base}";`, loader: 'js' };
      });
    },
  }],
});
check(true, 'бандл собран: build/smoke-app.mjs');

console.log('\n2. DOM-эмуляция и запуск приложения');
const window = new Window({ url: 'https://appassets.local/' });
const document = window.document;
document.body.innerHTML = '<div id="root"></div>';

const saved = [];
window.AnOOPlanNative = {
  platform: () => 'android',
  saveFile: (name, base64, mime) => {
    saved.push({ name, base64, mime });
    return 'ok:Download/AnOOPlan/' + name;
  },
};

const offline = async () => { throw new TypeError('Failed to fetch'); };
const fetchStub = async url => {
  if (String(url).includes('/api/')) {
    const error = new Error('offline');
    error.name = 'TypeError';
    throw error;
  }
  return new Response('', { status: 404 });
};

const globals = {
  window,
  document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  location: window.location,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  fetch: fetchStub,
  indexedDB: window.indexedDB ?? { open: offline },
  URL: window.URL,
  Blob: window.Blob,
  File: window.File,
  FormData: window.FormData,
  atob: window.atob.bind(window),
  btoa: window.btoa.bind(window),
};
for (const [key, value] of Object.entries(globals)) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    // некоторые свойства Node объявлены только для чтения — пропускаем
  }
}
window.fetch = fetchStub;
// В WebView confirm() показывает стандартный диалог; в эмуляции просто подтверждаем.
window.confirm = () => true;
window.alert = () => {};
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;

await import(bundleFile);
await new Promise(done => setTimeout(done, 300));

const bodyText = () => document.body.textContent || '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const buttonByText = text => buttons().find(button => (button.textContent || '').includes(text));

check(bodyText().includes('AnOOPlan'), 'интерфейс отрисован и показывает AnOOPlan');
check(bodyText().includes('Новый проект'), 'стартовый проект создан');
check(Boolean(document.querySelector('.plan-view')), 'план отрисован');

console.log('\n3. Офлайн-режим «Браузер»');
await new Promise(done => setTimeout(done, 1200));
check(Boolean(window.localStorage.getItem('cableplan:autosave')), 'автосохранение записало черновик в localStorage');

console.log('\n4. Учебный проект');
const demoButton = buttonByText('Учебный проект');
check(Boolean(demoButton), 'кнопка «Учебный проект» найдена');
if (demoButton) {
  demoButton.click();
  await new Promise(done => setTimeout(done, 400));
}
const nameInput = document.querySelector('input[aria-label="Название проекта"]');
const projectName = nameInput ? nameInput.value : '';
check(projectName.length > 0 && projectName !== 'Новый проект', `проект загружен: «${projectName}»`);

console.log('\n5. Экспорт CSV через нативный мост');
const csvButton = buttons().find(button => (button.textContent || '').trim() === 'CSV');
check(Boolean(csvButton), 'кнопка экспорта CSV найдена');
if (csvButton) {
  csvButton.click();
  await new Promise(done => setTimeout(done, 600));
}
check(saved.length >= 1, 'мост AnOOPlanNative получил файл');
if (saved.length) {
  const text = Buffer.from(saved[0].base64, 'base64').toString('utf8');
  check(saved[0].name.endsWith('.csv'), `имя файла: ${saved[0].name}`);
  check(text.startsWith('\uFEFF'), 'CSV начинается с BOM');
  check(text.includes('Кабельный журнал'), 'CSV содержит кабельный журнал');
  check(text.includes('Оборудование'), 'CSV содержит ведомость оборудования');
  check(/Download\/AnOOPlan/.test(bodyText()), 'пользователю показан путь сохранения');
}

console.log(`\nИтог: ${failures.length ? 'ПРОВАЛ' : 'УСПЕХ'}`);
if (failures.length) {
  failures.forEach(item => console.log(' - ' + item));
  process.exit(1);
}
