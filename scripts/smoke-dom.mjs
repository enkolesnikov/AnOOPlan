#!/usr/bin/env node
// Дымовой тест веб-приложения без браузера: сборка бандла, DOM-эмуляция (happy-dom).
// Проверяет загрузку интерфейса, офлайн-режим «Браузер», автосохранение, десятичную запятую,
// нижние панели действий, долгое нажатие и сохранение CSV через нативный мост AnOOPlanNative.
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
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));

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
const dirtyStates = [];
let exitCalled = false;
let vibrations = 0;
window.AnOOPlanNative = {
  platform: () => 'android',
  saveFile: (name, base64, mime) => {
    saved.push({ name, base64, mime });
    return 'ok:Download/AnOOPlan/' + name;
  },
  setDirty: value => dirtyStates.push(value),
  exitNow: () => { exitCalled = true; },
  vibrate: () => { vibrations += 1; },
};

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
  indexedDB: window.indexedDB ?? { open: async () => { throw new Error('offline'); } },
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
window.confirm = () => true;
window.alert = () => {};
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;

await import(bundleFile);
await sleep(300);

const bodyText = () => document.body.textContent || '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const buttonByText = text => buttons().find(button => (button.textContent || '').trim().includes(text));
const storedProjects = () => JSON.parse(window.localStorage.getItem('cableplan:projects') || '[]');

check(bodyText().includes('AnOOPlan'), 'интерфейс отрисован и показывает AnOOPlan');
check(bodyText().includes('Новый проект'), 'стартовый проект создан');
check(Boolean(document.querySelector('.plan-view')), 'план отрисован');

console.log('\n3. Офлайн-режим «Браузер»');
await sleep(1200);
check(Boolean(window.localStorage.getItem('cableplan:autosave')), 'автосохранение записало черновик в localStorage');
check(dirtyStates.length >= 1, 'состояние «не сохранён» передано в нативную оболочку');

console.log('\n4. Учебный проект и сохранение в список');
const demoButton = buttonByText('Учебный проект');
check(Boolean(demoButton), 'кнопка «Учебный проект» найдена');
if (demoButton) demoButton.click();
await sleep(400);
const nameInput = document.querySelector('input[aria-label="Название проекта"]');
const projectName = nameInput ? nameInput.value : '';
check(projectName.length > 0 && projectName !== 'Новый проект', `проект загружен: «${projectName}»`);
const saveButton = buttons().find(button => (button.textContent || '').trim() === 'Сохранить');
check(Boolean(saveButton), 'кнопка «Сохранить» доступна для нового проекта');
if (saveButton) saveButton.click();
await sleep(400);
check(storedProjects().length >= 1, 'проект записан в localStorage');

console.log('\n5. Десятичная запятая в числовых полях');
const elevation = Array.from(document.querySelectorAll('input')).find(input => (input.closest('label')?.textContent || '').includes('Отметка пола'));
check(Boolean(elevation), 'поле «Отметка пола, м» найдено');
if (elevation) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(elevation, '1,8');
  elevation.dispatchEvent(new window.Event('input', { bubbles: true }));
  check(elevation.value === '1,8', 'ввод «1,8» не стёрся (раньше type=number очищал поле)');
  await sleep(2200);
  const stored = storedProjects().find(project => project.name === projectName);
  const value = stored && stored.floors ? stored.floors[0].elevation : null;
  check(value === 1.8, `значение сохранено как 1.8 (получено: ${value})`);
  const primary = document.querySelector('.top-actions button.primary');
  check((primary?.textContent || '').includes('Сохранено'), 'кнопка сохранения показывает «Сохранено ✓»');
}

console.log('\n6. Экспорт CSV через нижнюю панель и нативный мост');
const exportTrigger = buttonByText('Экспорт / копия');
check(Boolean(exportTrigger), 'кнопка «Экспорт / копия» найдена');
if (exportTrigger) exportTrigger.click();
await sleep(200);
const csvButton = buttons().find(button => (button.textContent || '').trim() === 'CSV');
check(Boolean(csvButton), 'панель экспорта открыта и содержит CSV');
if (csvButton) {
  csvButton.click();
  await sleep(600);
}
check(saved.length >= 1, 'мост AnOOPlanNative получил файл');
if (saved.length) {
  const text = Buffer.from(saved[0].base64, 'base64').toString('utf8');
  check(saved[0].name.endsWith('.csv'), `имя файла: ${saved[0].name}`);
  check(text.startsWith('\uFEFF'), 'CSV начинается с BOM');
  check(text.includes('Кабельный журнал'), 'CSV содержит кабельный журнал');
  check(/Download\/AnOOPlan/.test(bodyText()), 'пользователю показан путь сохранения');
}

console.log('\n7. Долгое нажатие и панель действий');
const equipmentTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Оборуд'));
if (equipmentTab) equipmentTab.click();
await sleep(200);
const before = document.querySelectorAll('.object-row[data-kind="equipment"]').length;
const row = document.querySelector('.object-row[data-kind="equipment"]');
check(Boolean(row) && before > 0, `в списке есть оборудование: ${before}`);
if (row) {
  row.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20, pointerId: 1, pointerType: 'touch' }));
  await sleep(750);
  const sheet = document.querySelector('.sheet');
  check(Boolean(sheet) && (sheet.textContent || '').includes('Копировать'), 'долгое нажатие открыло панель действий');
  const copyButton = sheet ? Array.from(sheet.querySelectorAll('button')).find(button => (button.textContent || '').includes('Копировать')) : null;
  check(Boolean(copyButton), 'в панели есть «Копировать»');
  if (copyButton) {
    copyButton.click();
    await sleep(300);
    const after = document.querySelectorAll('.object-row[data-kind="equipment"]').length;
    check(after === before + 1, `копия создана: ${before} → ${after}`);
    check(!document.querySelector('.sheet'), 'панель закрылась после действия');
  }
}
check(vibrations > 0, 'тактильный отклик вызван через мост');

console.log('\n8. Выход с сохранением (кнопка «Назад» в Android)');
const saveAndExit = window.__anooplanSaveAndExit;
check(typeof saveAndExit === 'function', 'оболочке доступна функция saveAndExit');
if (typeof saveAndExit === 'function') {
  await saveAndExit();
  check(exitCalled, 'после сохранения запрошен выход');
}

console.log(`\nИтог: ${failures.length ? 'ПРОВАЛ' : 'УСПЕХ'}`);
if (failures.length) {
  failures.forEach(item => console.log(' - ' + item));
  process.exit(1);
}
