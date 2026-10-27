#!/usr/bin/env node
// Дымовой тест веб-приложения без браузера: сборка бандла, DOM-эмуляция (happy-dom).
// Проверяет загрузку интерфейса, офлайн-режим «Браузер», автосохранение, десятичную запятую,
// нижние панели действий, долгое нажатие и сохранение CSV через нативный мост AnOOPlanNative.
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'build');
await mkdir(OUT, { recursive: true });

const reactWarnings = [];
const originalConsoleError = console.error;
// Предупреждения React (например, отсутствующий key) — это дефект, а не шум.
console.error = (...args) => {
  const text = args.map(value => String(value)).join(' ');
  if (/Each child in a list|Warning:/.test(text)) reactWarnings.push(text);
  originalConsoleError(...args);
};

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
  loader: { '.css': 'empty', '.txt': 'text' },
  plugins: [{
    // Vite-импорт `?raw` (текст OFL) отдаём esbuild как обычный .txt.
    name: 'raw-suffix',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')) }));
    },
  }, {
    // PDF.js в smoke не рендерим: подложка демо-проекта недоступна без WebView.
    // Заглушка повторяет публичный API, чтобы динамический импорт не падал в Node.
    name: 'pdfjs-stub',
    setup(b) {
      b.onResolve({ filter: /^pdfjs-dist(\/|$)/ }, () => ({ path: 'pdfjs-stub', namespace: 'pdfjs-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'pdfjs-stub' }, () => ({
        contents: "export default '';\nexport const GlobalWorkerOptions = { workerSrc: '' };\nexport function getDocument() { return { promise: Promise.reject(new Error('PDF.js отключён в smoke-тесте')), destroy() { return Promise.resolve(); } }; }\n",
        loader: 'js',
      }));
    },
  }, {
    // Vite-специфичный импорт `?worker&url` заменяем на путь ассета.
    name: 'worker-url',
    setup(b) {
      b.onResolve({ filter: /\?worker&url$/ }, args => ({ path: args.path.replace(/\?worker&url$/, ''), namespace: 'worker-url' }));
      b.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default "/assets/pdf-worker.js";', loader: 'js' }));
    },
  }, {
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
const shareCalls = [];
let exitCalled = false;
let vibrations = 0;
const printCalls = [];
let pendingSharedFile = '';
window.AnOOPlanNative = {
  platform: () => 'android',
  saveFile: (name, base64, mime) => {
    saved.push({ name, base64, mime });
    return 'ok:Download/AnOOPlan/' + name;
  },
  shareFile: (name, base64, mime) => {
    shareCalls.push({ name, base64, mime });
    return 'ok:Системное меню «Поделиться»';
  },
  takePendingFile: () => pendingSharedFile,
  setDirty: value => dirtyStates.push(value),
  exitNow: () => { exitCalled = true; },
  vibrate: () => { vibrations += 1; },
  printPdf: (name, base64) => { printCalls.push({ name, base64 }); },
};

// Шрифты для PDF приложение тянет из собственных ассетов — отдаём их как статический сервер.
const FONT_DIR = join(ROOT, 'src', 'assets', 'fonts');
const FONT_FILES = ['AnOOPlanSans-Regular.ttf', 'AnOOPlanSans-Bold.ttf'];
const fetchStub = async url => {
  const value = String(url);
  if (value.includes('/api/')) {
    const error = new Error('offline');
    error.name = 'TypeError';
    throw error;
  }
  const name = value.split('/').pop() || '';
  if (FONT_FILES.includes(name)) {
    return new Response(readFileSync(join(FONT_DIR, name)), { status: 200, headers: { 'content-type': 'font/ttf' } });
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
  // В эмуляции IndexedDB нет: бросаем синхронно, как это делает браузер при запрете хранилища.
  indexedDB: window.indexedDB ?? { open: () => { throw new Error('offline'); } },
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

console.log('\n6b. Офлайн-экспорт XLSX и PDF журнала');
const byExtension = extension => saved.filter(entry => entry.name.endsWith(extension)).pop();
async function exportFormat(label, wait) {
  const trigger = buttons().find(button => (button.textContent || '').includes('Экспорт / копия'));
  if (!trigger) return false;
  trigger.click();
  await sleep(150);
  const target = buttons().find(button => (button.textContent || '').trim() === label);
  if (!target) return false;
  target.click();
  await sleep(wait);
  return true;
}
check(await exportFormat('XLSX', 1500), 'кнопка XLSX сработала');
const xlsxEntry = byExtension('.xlsx');
check(Boolean(xlsxEntry), 'мост получил файл .xlsx');
if (xlsxEntry) {
  const bytes = Buffer.from(xlsxEntry.base64, 'base64');
  check(bytes.length > 5000, `размер XLSX: ${bytes.length} байт`);
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  check(workbook.SheetNames.includes('Кабельный журнал'), 'в книге есть лист «Кабельный журнал»');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Кабельный журнал'], { defval: '' });
  check(rows.length > 0 && 'Итог одного, м' in rows[0], 'в журнале есть итоговые метры');
}
check(await exportFormat('PDF', 3000), 'кнопка PDF сработала');
const pdfEntry = byExtension('.pdf');
check(Boolean(pdfEntry), 'мост получил файл .pdf');
if (pdfEntry) {
  const bytes = Buffer.from(pdfEntry.base64, 'base64');
  check(bytes.subarray(0, 5).toString() === '%PDF-', 'файл начинается с %PDF-');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  let text = '';
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    text += content.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n';
  }
  const pages = document.numPages;
  await task.destroy();
  check(text.includes('Кабельный журнал') && text.includes('Итого, м'), 'в тексте PDF есть журнал и колонка итога');
  check(pages >= 1, `страниц в PDF: ${pages}`);
}
check(/Download\/AnOOPlan/.test(bodyText()), 'путь сохранения показан в интерфейсе');

console.log('\n6c. Смета и справочник цен');
const estimateTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'Смета');
check(Boolean(estimateTab), 'вкладка «Смета» доступна');
if (estimateTab) estimateTab.click();
await sleep(300);
const estimateView = document.querySelector('.estimate-view');
check(Boolean(estimateView), 'экран сметы открылся');
const estimateText = estimateView?.textContent || '';
check(estimateText.includes('Смета и коммерческое предложение'), 'заголовок «Смета и коммерческое предложение» показан');
check(estimateText.includes('Дата прайса'), 'в смете показана дата прайса');
const estimateSections = Array.from(document.querySelectorAll('.estimate-section-head h2')).map(node => (node.textContent || '').trim());
for (const title of ['Оборудование', 'Кабели', 'Лотки', 'Работы']) {
  check(estimateSections.includes(title), `в смете есть раздел «${title}»: ${estimateSections.join(', ')}`);
}
const estimateSectionNodes = Array.from(document.querySelectorAll('.estimate-section'));
const workSectionNode = estimateSectionNodes.find(node => (node.querySelector('h2')?.textContent || '').trim() === 'Работы');
const workSectionText = workSectionNode?.textContent || '';
check(/Работы — 25 % от стоимости материалов/.test(workSectionText), `раздел «Работы» объясняет процент, а не пустая таблица: ${workSectionText.slice(0, 140)}`);
check(!workSectionText.includes('Позиций нет'), 'в разделе «Работы» нет строки «Позиций нет»');
check(Boolean(workSectionNode?.querySelector('.estimate-work-summary')) && !workSectionNode?.querySelector('table'), 'раздел «Работы» без таблицы позиций');
const materialTables = estimateSectionNodes.filter(node => (node.querySelector('h2')?.textContent || '').trim() !== 'Работы').filter(node => node.querySelector('table.estimate-table'));
check(materialTables.length === 3, `у материальных разделов таблица позиций сохранена: ${materialTables.length}/3`);
const estimateTotal = () => (document.querySelector('.estimate-total-value')?.textContent || '').trim();
const totalNumber = () => Number(estimateTotal().replace(/[^\d,.-]/g, '').replace(',', '.'));
check(/\d/.test(estimateTotal()), `итог сметы показан числом: ${estimateTotal()}`);
const laborInput = document.querySelector('input[aria-label="Работы, %"]');
check(Boolean(laborInput) && (laborInput.value || '').replace(',', '.') === '25', `поле «Работы, %» = 25 (получено: ${laborInput?.value || '—'})`);
const catalogDetails = document.querySelector('.catalog-editor');
check(Boolean(catalogDetails), 'блок «Справочник цен» есть на экране сметы');
if (catalogDetails) catalogDetails.open = true;
await sleep(120);
const catalogPrices = Array.from(document.querySelectorAll('.catalog-price input')).map(input => (input.value || '').replace(/\s/g, ''));
check(catalogPrices.includes('28500') && catalogPrices.includes('6500'), `в справочнике есть цены 28500 и 6500: ${catalogPrices.slice(0, 6).join(', ')}`);
const catalogExport = Array.from(document.querySelectorAll('.catalog-actions button')).find(button => (button.textContent || '').includes('Экспорт справочника'));
check(Boolean(catalogExport), 'кнопка «Экспорт справочника» есть');
const catalogImport = Array.from(document.querySelectorAll('.catalog-actions button')).find(button => (button.textContent || '').includes('Импорт JSON'));
check(Boolean(catalogImport), 'кнопка «Импорт JSON» есть');
const catalogTableImport = Array.from(document.querySelectorAll('.catalog-actions button')).find(button => (button.textContent || '').includes('Импорт XLSX/CSV'));
check(Boolean(catalogTableImport), 'кнопка «Импорт XLSX/CSV» есть');
const catalogSeries = document.querySelector('.catalog-series input');
check(Boolean(catalogSeries), 'поле «Серия» в справочнике есть');
check(Boolean(document.querySelector('input.catalog-import-input[type="file"]')), 'скрытое поле импорта JSON подключено');
const catalogSavedBefore = saved.filter(file => file.name.endsWith('.json')).length;
let exportedCatalog = null;
if (catalogExport) {
  catalogExport.click();
  await sleep(600);
  const catalogFiles = saved.filter(file => file.name.endsWith('.json'));
  const statusText = document.querySelector('.statusbar')?.textContent || '';
  check(catalogFiles.length > catalogSavedBefore || /каталог/i.test(statusText), `экспорт справочника сработал через мост или сообщение: ${catalogFiles.map(file => file.name).pop() || statusText.slice(0, 60)}`);
  if (catalogFiles.length) {
    let exported = null;
    try { exported = JSON.parse(Buffer.from(catalogFiles[catalogFiles.length - 1].base64, 'base64').toString('utf8')); } catch { exported = null; }
    exportedCatalog = exported;
    check(Boolean(exported) && Array.isArray(exported.catalog) && exported.catalog.length > 0, `в JSON экспорта непустой справочник: ${exported?.catalog?.length ?? 0} поз.`);
    check(exported?.catalogDate === '2026-10-01', `в JSON экспорта дата прайса: ${exported?.catalogDate ?? '—'}`);
    check(Boolean(exported) && !Object.prototype.hasOwnProperty.call(exported, 'estimate'), 'в JSON экспорта нет сметы — формат симметричен импорту');
  }
}
const beforeLaborTotal = totalNumber();
if (laborInput) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(laborInput, '30');
  laborInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(350);
  const afterLaborTotal = totalNumber();
  check(Number.isFinite(beforeLaborTotal) && Number.isFinite(afterLaborTotal) && afterLaborTotal > beforeLaborTotal, `изменение «Работы, %» меняет ИТОГО: ${beforeLaborTotal} → ${afterLaborTotal}`);
  const laborAfter = document.querySelector('input[aria-label="Работы, %"]');
  setter.call(laborAfter, '25');
  laborAfter.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(250);
}
const catalogDateInput = document.querySelector('input[aria-label="Дата прайса"]');
const catalogImportInput = document.querySelector('input.catalog-import-input');
check(Boolean(catalogDateInput) && (catalogDateInput.value || '') === '2026-10-01', `дата прайса в форме до импорта: ${catalogDateInput?.value || '—'}`);
const setCatalogImportFiles = payload => {
  const file = new window.File([JSON.stringify(payload)], 'catalog.json', { type: 'application/json' });
  Object.defineProperty(catalogImportInput, 'files', { configurable: true, value: [file] });
  catalogImportInput.dispatchEvent(new window.Event('change', { bubbles: true }));
};
if (catalogImportInput && catalogDateInput) {
  setCatalogImportFiles({ catalog: [{ id: 'import-1', kind: 'equipment', name: 'Импорт тест', unit: 'шт', price: 100, note: '' }], catalogDate: '2026-02-30' });
  await sleep(500);
  check((catalogDateInput.value || '') === '2026-10-01', `невалидная дата «2026-02-30» не сохраняется, дата прайса прежняя: ${catalogDateInput.value || '—'}`);
  const importedNames = Array.from(document.querySelectorAll('.catalog-name input')).map(input => input.value);
  check(importedNames.includes('Импорт тест'), `импорт с невалидной датой заменил позиции справочника: ${importedNames.join(', ').slice(0, 80)}`);
  setCatalogImportFiles({ catalog: [{ id: 'import-2', kind: 'cable', name: 'Кабель тест', unit: 'м', price: 50, note: '' }], catalogDate: '2026-05-01' });
  await sleep(500);
  check((catalogDateInput.value || '') === '2026-05-01', `валидная дата импорта сохраняется: ${catalogDateInput.value || '—'}`);
  if (exportedCatalog) {
    setCatalogImportFiles(exportedCatalog);
    await sleep(600);
    check((catalogDateInput.value || '') === '2026-10-01', `корректный импорт ставит валидную дату прайса: ${catalogDateInput.value || '—'}`);
    const restoredNames = document.querySelectorAll('.catalog-name input').length;
    check(restoredNames === exportedCatalog.catalog.length, `корректный импорт восстанавливает позиции: ${restoredNames}/${exportedCatalog.catalog.length}`);
  }
}
const planTabBack = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'План');
if (planTabBack) planTabBack.click();
await sleep(200);

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

console.log('\n7b. Жест масштабирования не должен создавать оборудование');
const stage = document.querySelector('.drawing-stage');
const equipmentTool = Array.from(document.querySelectorAll('.drawing-toolbar button')).find(button => (button.textContent || '').includes('Оборудование'));
check(Boolean(equipmentTool), 'инструмент «Оборудование» найден');
if (equipmentTool) equipmentTool.click();
await sleep(120);
const equipmentCount = () => document.querySelectorAll('[data-object="equipment"]').length;
const pointer = (type, id, x, y) => stage.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch' }));
const beforePinch = equipmentCount();
const sheetStyle = () => document.querySelector('.drawing-sheet')?.getAttribute('style') || '';
const beforeStyle = sheetStyle();
pointer('pointerdown', 1, 120, 200);
pointer('pointerdown', 2, 220, 300);
pointer('pointermove', 1, 100, 180);
pointer('pointermove', 2, 240, 320);
pointer('pointerup', 1, 100, 180);
pointer('pointerup', 2, 240, 320);
await sleep(200);
check(equipmentCount() === beforePinch, `двухпальцевый жест не создал оборудование (${beforePinch} → ${equipmentCount()})`);
check(sheetStyle() !== beforeStyle, 'жест изменил масштаб или положение листа');
pointer('pointerdown', 3, 150, 250);
await sleep(40);
pointer('pointerup', 3, 150, 250);
await sleep(250);
check(equipmentCount() === beforePinch + 1, `одиночный тап создал оборудование (${beforePinch} → ${equipmentCount()})`);
const propertiesText = document.querySelector('.properties')?.textContent || '';
check(propertiesText.includes('Фотографии'), 'в свойствах оборудования есть блок «Фотографии»');
check(Boolean(document.querySelector('.photo-add')), 'кнопка «＋ Фото» доступна');

console.log('\n7c. Рулетка');
const measureTool = Array.from(document.querySelectorAll('.drawing-toolbar button')).find(button => (button.textContent || '').includes('Рулетка'));
check(Boolean(measureTool), 'кнопка «Рулетка» есть в панели инструментов');
if (measureTool) {
  measureTool.click();
  await sleep(120);
  pointer('pointerdown', 4, 100, 100);
  await sleep(30);
  pointer('pointerup', 4, 100, 100);
  await sleep(80);
  pointer('pointerdown', 5, 200, 100);
  await sleep(30);
  pointer('pointerup', 5, 200, 100);
  await sleep(150);
  const status = document.querySelector('.statusbar')?.textContent || '';
  check(/Рулетка: .+ (м|ед\.)/.test(status), `рулетка показала расстояние: ${status.slice(0, 140)}`);
}

console.log('\n7d. Площадь контура');
const areaButton = buttons().find(button => (button.textContent || '').trim() === 'Площадь');
check(Boolean(areaButton), 'переключатель «Площадь» доступен в режиме замера');
if (areaButton) {
  areaButton.click();
  await sleep(120);
  for (const [id, x, y] of [[6, 60, 60], [7, 160, 60], [8, 160, 160]]) {
    pointer('pointerdown', id, x, y);
    await sleep(30);
    pointer('pointerup', id, x, y);
    await sleep(60);
  }
  const status = document.querySelector('.statusbar')?.textContent || '';
  check(/Площадь: .+ (м²|ед\.²)/.test(status), `площадь посчитана: ${status.slice(0, 140)}`);
}

console.log('\n7e. Масштаб по формату листа');
const floorsTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Этажи'));
if (floorsTab) floorsTab.click();
await sleep(150);
const floorRow = document.querySelector('.object-row');
if (floorRow) floorRow.click();
await sleep(150);
const applyScale = buttons().find(button => (button.textContent || '').includes('Применить масштаб листа'));
check(Boolean(applyScale), 'кнопка «Применить масштаб листа» есть в свойствах этажа');
if (applyScale) {
  applyScale.click();
  await sleep(300);
  const status = document.querySelector('.statusbar')?.textContent || '';
  check(/Масштаб по листу A1 1:100/.test(status), `масштаб применён: ${status.slice(0, 140)}`);
}

console.log('\n7f. Печать A4 через системный диалог');
check(Boolean(document.querySelector('input[capture]')), 'поле съёмки с камерой присутствует');
const exportForPrint = buttons().find(button => (button.textContent || '').includes('Экспорт / копия'));
if (exportForPrint) exportForPrint.click();
await sleep(150);
const compiledInput = document.querySelector('.sheet-fields input');
check(Boolean(compiledInput), 'в панели экспорта есть поле «Составил»');
if (compiledInput) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(compiledInput, 'Иванов И.И.');
  compiledInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(150);
}
const printButton = buttons().find(button => (button.textContent || '').trim() === 'Печать выбранных разделов');
check(Boolean(printButton), 'кнопка «Печать выбранных разделов» доступна в приложении');
if (printButton) {
  const printBaseline = printCalls.length;
  printButton.click();
  await sleep(2500);
  check(printCalls.length === printBaseline + 1, `мост печати вызван: ${printCalls.length - printBaseline}`);
  if (printCalls.length > printBaseline) {
    const lastPrint = printCalls[printCalls.length - 1];
    const bytes = Buffer.from(lastPrint.base64, 'base64');
    check(bytes.subarray(0, 5).toString() === '%PDF-', 'в печать ушёл корректный PDF');
    check(lastPrint.name.length > 0, `имя задания: ${lastPrint.name}`);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    const document = await task.promise;
    let text = '';
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      text += content.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n';
    }
    await task.destroy();
    check(text.includes('Составил') && text.includes('Иванов И.И.'), 'подпись составителя попала в PDF');
    check(text.includes('Итого кабеля по журналу'), 'итог по смете попал в PDF');
  }
}

console.log('\n7g. Смета, журнал и история версий');
const cablesTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Кабели'));
if (cablesTab) cablesTab.click();
await sleep(200);
const cableRow = document.querySelector('.object-row[data-kind="cable"]');
if (cableRow) cableRow.click();
await sleep(200);
const priceField = Array.from(document.querySelectorAll('.properties label')).find(label => (label.textContent || '').includes('Цена за метр'));
check(Boolean(priceField), 'в свойствах кабеля есть поле «Цена за метр»');
const journalTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').includes('Журнал'));
if (journalTab) journalTab.click();
await sleep(250);
const journalText = document.querySelector('.main-area')?.textContent || '';
check(journalText.includes('Стоимость'), 'в журнале есть колонка стоимости');
check(Boolean(document.querySelector('.document-summary')), 'под журналом выводится итог по метражу и стоимости');
const exportForHistory = buttons().find(button => (button.textContent || '').includes('Экспорт / копия'));
if (exportForHistory) exportForHistory.click();
await sleep(150);
const historyButton = buttons().find(button => (button.textContent || '').trim() === 'История версий');
check(Boolean(historyButton), 'кнопка «История версий» доступна');
if (historyButton) {
  historyButton.click();
  await sleep(300);
  const sheet = document.querySelector('.sheet');
  check(Boolean(sheet) && (sheet.textContent || '').includes('История версий'), 'панель истории версий открылась');
  const makeSnapshot = buttons().find(button => (button.textContent || '').includes('Сделать снимок'));
  check(Boolean(makeSnapshot), 'в истории есть кнопка снимка');
}

console.log('\n7h. Отмена, нумерация сегментов и замечания');
const planTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'План');
if (planTab) planTab.click();
await sleep(200);
const accessiblePlan = document.querySelector('.sr-only')?.textContent || '';
check(accessiblePlan.includes('Объекты на плане'), 'есть текстовая альтернатива плана для скринридера');
check(/[A-ZА-Я]\d+/.test(accessiblePlan), 'в текстовой альтернативе перечислено оборудование');

const pinsTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Зам.'));
check(Boolean(pinsTab), 'вкладка «Зам.» доступна');
if (pinsTab) {
  pinsTab.click();
  await sleep(200);
  const pinRow = document.querySelector('.object-row[data-kind="pin"]');
  check(Boolean(pinRow), 'в демо-проекте есть замечания');
  if (pinRow) {
    pinRow.click();
    await sleep(200);
    const pinProperties = document.querySelector('.properties')?.textContent || '';
    check(pinProperties.includes('ЗАМЕЧАНИЕ'), 'открылись свойства замечания');
    const pinComment = Array.from(document.querySelectorAll('.properties textarea'))[0];
    if (pinComment) {
      pinComment.value = 'Проверить крепление лотка';
      pinComment.dispatchEvent(new window.Event('input', { bubbles: true }));
      await sleep(150);
      check(pinComment.value === 'Проверить крепление лотка', 'текст замечания сохраняется');
    }
    const pinStatus = Array.from(document.querySelectorAll('.properties select')).find(select => Array.from(select.options).some(option => option.value === 'closed'));
    if (pinStatus) {
      pinStatus.value = 'closed';
      pinStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(150);
      const updatedRow = document.querySelector('.object-row[data-kind="pin"]');
      check((updatedRow?.textContent || '').includes('закрыто'), 'статус замечания переключается');
    }
  }
}

const undoButton = buttons().find(button => (button.getAttribute('title') || '').includes('Отменить'));
check(Boolean(undoButton), 'кнопка «Отменить» присутствует в панели инструментов');
check(Boolean(buttons().find(button => (button.getAttribute('title') || '').includes('Повторить'))), 'кнопка «Повторить» присутствует');
const routesTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Трассы'));
if (routesTab) routesTab.click();
await sleep(200);
const routeRow = document.querySelector('.object-row[data-kind="route"]');
check(Boolean(routeRow), 'в списке есть трассы');
check(Boolean(document.querySelector('.route-summary')), 'есть сводка метража по типам КНС');
check((document.querySelector('.route-summary')?.textContent || '').includes('м'), 'в сводке показан метраж трасс');
check((routeRow?.textContent || '').includes(' м · '), 'в строке трассы показана длина');
const dimensionTool = Array.from(document.querySelectorAll('.drawing-toolbar button')).find(button => (button.textContent || '').includes('Размер'));
check(Boolean(dimensionTool), 'инструмент «Размер» доступен');
if (routeRow) {
  routeRow.click();
  await sleep(250);
  const properties = document.querySelector('.properties')?.textContent || '';
  check(/Сегмент\s+[^\s.]+\.1/.test(properties), `сегменты нумеруются как Т1.1 (найдено: ${properties.slice(0, 160)})`);
}
const health = document.querySelector('.project-health')?.textContent || '';
check(/замечани/.test(health), `контроль данных показывает замечания: ${health.slice(0, 60)}`);

console.log('\n7i. О программе и лицензии');
const aboutButton = buttons().find(button => (button.textContent || '').includes('О программе'));
check(Boolean(aboutButton), 'кнопка «О программе / Лицензии» доступна');
if (aboutButton) {
  aboutButton.click();
  await sleep(250);
  const aboutSheet = document.querySelector('.about-sheet');
  check(Boolean(aboutSheet), 'экран «О программе» открылся');
  const aboutText = aboutSheet?.textContent || '';
  check(aboutText.includes('SIL OPEN FONT LICENSE'), 'текст OFL для PT Sans показан');
  check(aboutText.includes('PT Sans'), 'шрифт PT Sans указан в лицензиях');
  check(/версия \d+\.\d+\.\d+/.test(aboutText), 'версия приложения показана');
  check(aboutText.includes('Диагностика'), 'раздел диагностики показан');
  const diagnosticsButton = buttons().find(button => (button.textContent || '').trim() === 'Скачать журнал');
  check(Boolean(diagnosticsButton), 'кнопка «Скачать журнал» доступна');
  if (diagnosticsButton) {
    diagnosticsButton.click();
    await sleep(400);
    const diagnosticFile = saved.find(file => file.name.endsWith('.txt'));
    check(Boolean(diagnosticFile), 'журнал диагностики сохранён через мост');
    if (diagnosticFile) {
      const text = Buffer.from(diagnosticFile.base64, 'base64').toString('utf8');
      check(text.includes('AnOOPlan — диагностика'), 'в журнале есть заголовок');
      check(text.includes('Версия приложения:'), 'в журнале есть версия');
    }
  }
  const closeAbout = aboutSheet?.querySelector('.sheet-head button');
  if (closeAbout) closeAbout.click();
  await sleep(150);
  check(!document.querySelector('.about-sheet'), 'экран «О программе» закрывается');
}

console.log('\n7j. Заполнение лотка: свойства и ведомости');
const cablesTabFill = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Кабели'));
if (cablesTabFill) cablesTabFill.click();
await sleep(200);
const fillCableRow = document.querySelector('.object-row[data-kind="cable"]');
check(Boolean(fillCableRow), 'в демо-проекте есть кабель для проверки диаметра');
if (fillCableRow) {
  fillCableRow.click();
  await sleep(250);
  const cableLabels = Array.from(document.querySelectorAll('.properties label')).map(label => label.textContent || '');
  check(cableLabels.some(text => text.includes('Внешний диаметр, мм')), 'в свойствах кабеля есть поле «Внешний диаметр, мм»');
  check(cableLabels.some(text => text.includes('Площадь сечения, мм²')), 'в свойствах кабеля есть поле «Площадь сечения, мм²»');
  check(cableLabels.some(text => text.includes('Ручная цена; если пусто — берётся из справочника цен')), 'у «Цена за метр» есть подсказка про справочник цен');
  const diameterField = Array.from(document.querySelectorAll('.properties label')).find(label => (label.textContent || '').includes('Внешний диаметр, мм'));
  const diameterInput = diameterField?.querySelector('input');
  const diameterValue = Number((diameterInput?.value || '').replace(',', '.'));
  check(Number.isFinite(diameterValue) && diameterValue > 0, `демо-кабель имеет диаметр (${diameterInput?.value || '—'})`);
  const calculationText = document.querySelector('.calculation-card')?.textContent || '';
  check(calculationText.includes('Сечение') && calculationText.includes('мм²'), 'в расчёте кабеля показано сечение, мм²');
  check(calculationText.includes('Заполнение КНС'), 'в расчёте кабеля показано заполнение КНС');
}

const routesTabFill = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Трассы'));
if (routesTabFill) routesTabFill.click();
await sleep(200);
const fillRouteRow = document.querySelector('.object-row[data-kind="route"]');
check(Boolean(fillRouteRow), 'в демо-проекте есть трасса для проверки лотка');
if (fillRouteRow) {
  fillRouteRow.click();
  await sleep(250);
}
const routeLabels = Array.from(document.querySelectorAll('.properties label')).map(label => label.textContent || '');
check(routeLabels.some(text => text.includes('Ширина, мм')), 'в свойствах трассы есть поле «Ширина, мм»');
check(routeLabels.some(text => text.includes('Высота борта, мм')), 'в свойствах трассы есть поле «Высота борта, мм»');
check(routeLabels.some(text => text.includes('Площадь сечения, мм²')), 'в свойствах трассы есть поле «Площадь сечения, мм²»');
const routeProperties = document.querySelector('.properties')?.textContent || '';
check(routeProperties.includes('Заполнение КНС'), 'в свойствах трассы есть блок «Заполнение КНС»');
check(routeProperties.includes('Подсистема СКС'), 'в свойствах трассы есть подсистема СКС');
check(routeProperties.includes('Подобрать стандартное сечение'), 'в свойствах трассы есть подбор сечения');
// Типы КНС и цвета: выбор типа меняет подписи размеров, цвет — палитра.
const kindChips = Array.from(document.querySelectorAll('.properties .chip-row .chip')).map(button => (button.textContent || '').trim());
for (const label of ['Лоток', 'Гофра', 'Труба', 'Кабель-канал']) check(kindChips.includes(label), `в свойствах трассы есть тип КНС «${label}»`);
check(Boolean(document.querySelector('.properties .color-swatches .color-swatch')), 'в свойствах трассы есть палитра цвета');
check(Boolean(document.querySelector('.properties .color-swatches .color-default')), 'есть сброс цвета «По умолчанию»');
const chipByLabel = label => Array.from(document.querySelectorAll('.properties .chip-row .chip')).find(button => (button.textContent || '').trim() === label);
const corrugatedChip = chipByLabel('Гофра');
if (corrugatedChip) { corrugatedChip.click(); await sleep(260); }
const corrugatedLabels = Array.from(document.querySelectorAll('.properties label')).map(label => label.textContent || '');
check(corrugatedLabels.some(text => text.includes('Внутренний диаметр, мм')), 'для гофры показывается поле «Внутренний диаметр, мм»');
check(!corrugatedLabels.some(text => text.includes('Высота борта, мм')), 'для гофры высота борта скрыта');
check((document.querySelector('.properties')?.textContent || '').includes('Гофра'), 'тип трассы переключился на «Гофра»');
const trayChip = chipByLabel('Лоток');
if (trayChip) { trayChip.click(); await sleep(220); }
const trayLabelsBack = Array.from(document.querySelectorAll('.properties label')).map(label => label.textContent || '');
check(trayLabelsBack.some(text => text.includes('Высота борта, мм')), 'переключение обратно на «Лоток» возвращает высоту борта');
const trayFillRows = Array.from(document.querySelectorAll('.tray-fill-row'));
check(trayFillRows.length > 0, `в блоке заполнения есть строки сегментов (${trayFillRows.length})`);
check(trayFillRows.some(row => /\d+([.,]\d+)?\s*%/.test(row.textContent || '')), 'в строке сегмента показан процент заполнения');
const trayFillStatuses = Array.from(document.querySelectorAll('.tray-fill-row em')).map(cell => (cell.textContent || '').trim());
check(trayFillStatuses.some(text => ['ок', 'внимание', 'превышено', 'пусто', 'неполный'].includes(text)), `статус сегмента по-русски: ${trayFillStatuses.slice(0, 3).join(' | ') || '—'}`);

const specsTabFill = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'Ведомости');
check(Boolean(specsTabFill), 'вкладка «Ведомости» доступна');
if (specsTabFill) {
  specsTabFill.click();
  await sleep(300);
}
const traySection = Array.from(document.querySelectorAll('.spec-section')).find(section => (section.querySelector('h2')?.textContent || '').includes('Заполнение КНС'));
check(Boolean(traySection), 'в ведомостях есть раздел «Заполнение КНС»');
if (traySection) {
  const headers = Array.from(traySection.querySelectorAll('th')).map(cell => (cell.textContent || '').trim());
  check(headers.includes('Заполнение, %'), `в таблице есть колонка «Заполнение, %»: ${headers.join(', ')}`);
  check(headers.includes('Статус'), 'в таблице заполнения есть колонка «Статус»');
  const percentIndex = headers.indexOf('Заполнение, %');
  const statusIndex = headers.indexOf('Статус');
  const rows = Array.from(traySection.querySelectorAll('tbody tr'));
  const percents = rows.map(row => (row.children[percentIndex]?.textContent || '').trim());
  check(percents.some(value => /^\d/.test(value) && Number(value.replace(/\s/g, '').replace(',', '.')) > 0), `в таблице есть рассчитанный процент: ${percents.slice(0, 3).join(' | ') || '—'}`);
  const statuses = rows.map(row => (row.children[statusIndex]?.textContent || '').trim());
  check(statuses.some(value => ['ок', 'внимание', 'превышено', 'пусто', 'неполный'].includes(value)), `статусы в ведомости читаемые: ${statuses.slice(0, 3).join(' | ') || '—'}`);
}
const infrastructureSection = Array.from(document.querySelectorAll('.spec-section')).find(section => (section.querySelector('h2')?.textContent || '').includes('Кабельная инфраструктура'));
check(Boolean(infrastructureSection) && (infrastructureSection.textContent || '').includes('Макс. заполнение, %'), 'в инфраструктуре есть колонка «Макс. заполнение, %»');

console.log('\n7j-2. Сегментные размеры КНС');
const segmentPlanTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'План');
if (segmentPlanTab) segmentPlanTab.click();
await sleep(200);
const segmentRoutesTab = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Трассы'));
if (segmentRoutesTab) segmentRoutesTab.click();
await sleep(200);
const segmentRouteRow = document.querySelector('.object-row[data-kind="route"]');
if (segmentRouteRow) { segmentRouteRow.click(); await sleep(300); }
const segmentEditors = document.querySelectorAll('.properties .segment-editor');
check(segmentEditors.length > 1, `в свойствах трассы есть редакторы сегментов (${segmentEditors.length})`);
const segmentEditorText = () => document.querySelector('.properties .segment-editor')?.textContent || '';
check(segmentEditorText().includes('Сечение КНС на сегменте'), 'у сегмента есть блок «Сечение КНС на сегменте»');
check(segmentEditorText().includes('Пустое поле — размер трассы'), 'у сегментного сечения есть подсказка про наследование размера трассы');
const segmentSectionText = () => document.querySelector('.properties .segment-editor .section-label span')?.textContent || '';
check(segmentSectionText().includes('100×50'), `до правки сегмент использует лоток трассы: ${segmentSectionText()}`);
const segmentField = text => Array.from((document.querySelector('.properties .segment-editor') || document).querySelectorAll('label')).find(label => (label.textContent || '').includes(text));
// React слушает нативный value-сеттер: прямое присваивание input.value не считается изменением.
const nativeValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const segmentWidthInput = segmentField('Ширина, мм')?.querySelector('input');
if (segmentWidthInput) { nativeValue(segmentWidthInput, '50'); await sleep(400); }
const segmentHeightInput = segmentField('Высота борта, мм')?.querySelector('input');
if (segmentHeightInput) { nativeValue(segmentHeightInput, '50'); await sleep(400); }
check(segmentSectionText().includes('50×50'), `своё сечение сегмента показано в свойствах: ${segmentSectionText()}`);
check(segmentSectionText().includes('своё'), 'сечение помечено как своё');
const firstFillRowText = document.querySelector('.properties .tray-fill .tray-fill-row')?.textContent || '';
check(firstFillRowText.includes('50×50'), `сегментная строка заполнения использует сечение сегмента: ${firstFillRowText.slice(0, 80)}`);
const segmentFillText = document.querySelector('.properties .segment-editor .segment-fill')?.textContent || '';
check(segmentFillText.includes('50×50'), `в редакторе сегмента показано его сечение: ${segmentFillText.slice(0, 80)}`);
const segmentResetButton = Array.from(document.querySelectorAll('.properties .segment-editor button')).find(button => (button.textContent || '').includes('Как у трассы'));
check(Boolean(segmentResetButton), 'есть кнопка сброса сечения к трассе');
if (segmentResetButton) {
  segmentResetButton.click();
  await sleep(400);
}
check(segmentSectionText().includes('100×50') && !segmentSectionText().includes('своё'), `после сброса сегмент снова использует лоток трассы: ${segmentSectionText()}`);
const resetFillRowText = document.querySelector('.properties .tray-fill .tray-fill-row')?.textContent || '';
check(resetFillRowText.includes('100×50'), `строка заполнения вернулась к лотку трассы: ${resetFillRowText.slice(0, 80)}`);

const segmentSpecsTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'Ведомости');
if (segmentSpecsTab) { segmentSpecsTab.click(); await sleep(700); }
const schemeSection = Array.from(document.querySelectorAll('.spec-section')).find(section => (section.querySelector('h2')?.textContent || '').includes('Схема трасс'));
check(Boolean(schemeSection), 'в ведомостях есть раздел «Схема трасс»');
if (schemeSection) {
  const schemeHeaders = Array.from(schemeSection.querySelectorAll('th')).map(cell => (cell.textContent || '').trim());
  check(schemeHeaders.includes('Сечения'), `в схеме трасс есть колонка «Сечения»: ${schemeHeaders.join(', ')}`);
  const sectionCells = Array.from(schemeSection.querySelectorAll('tbody tr'))
    .map(row => (row.children[schemeHeaders.indexOf('Сечения')]?.textContent || '').trim())
    .filter(Boolean);
  check(sectionCells.some(value => /\d+×\d+ — \d/.test(value)), `в схеме трасс показан метраж по сечению: ${sectionCells.slice(0, 2).join(' | ')}`);
}

console.log('\n7k. Иконки оборудования и выбор цвета');
const planViewTab = Array.from(document.querySelectorAll('.view-tabs button')).find(button => (button.textContent || '').trim() === 'План');
if (planViewTab) planViewTab.click();
await sleep(250);
const floorsTabIcons = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Этажи'));
if (floorsTabIcons) floorsTabIcons.click();
await sleep(200);
const floorRows = Array.from(document.querySelectorAll('.object-row'));
const markersByFloor = [];
for (const floorRow of floorRows) {
  floorRow.click();
  await sleep(200);
  markersByFloor.push(Array.from(document.querySelectorAll('[data-object="equipment"]')).map(node => ({
    icon: node.getAttribute('data-icon'),
    color: node.getAttribute('data-color'),
    text: node.textContent || '',
  })));
}
const allMarkers = markersByFloor.flat();
const markerIcons = allMarkers.map(marker => marker.icon);
check(markerIcons.includes('camera'), `на плане есть маркер data-icon="camera": ${[...new Set(markerIcons)].join(', ')}`);
check(markerIcons.includes('cabinet'), 'на плане есть маркер data-icon="cabinet"');
check(markerIcons.includes('socket'), 'на плане есть маркер data-icon="socket"');
const markerColors = allMarkers.map(marker => marker.color || '');
check(markerColors.length > 0 && markerColors.every(value => /^#[0-9a-f]{6}$/i.test(value)), `у маркеров плана валидный data-color: ${[...new Set(markerColors)].slice(0, 4).join(', ')}`);
check(document.querySelectorAll('[data-object="equipment"] .equipment-badge').length > 0, 'маркер рисуется бейджем с иконкой (SVG)');
check(document.querySelectorAll('[data-object="equipment"] path').length > 0, 'внутри маркера есть SVG-глиф иконки');

const equipmentTabIcons = Array.from(document.querySelectorAll('.structure-tabs button')).find(button => (button.textContent || '').includes('Оборуд'));
if (equipmentTabIcons) equipmentTabIcons.click();
await sleep(200);
const equipmentRows = Array.from(document.querySelectorAll('.object-row[data-kind="equipment"]'));
const rowsWithIcon = equipmentRows.filter(row => row.querySelector('.object-icon svg'));
check(equipmentRows.length > 0, `в списке «Оборуд.» есть строки: ${equipmentRows.length}`);
check(rowsWithIcon.length === equipmentRows.length, `у каждой строки списка SVG-иконка: ${rowsWithIcon.length}/${equipmentRows.length}`);

const cameraRow = equipmentRows.find(row => (row.textContent || '').includes('Камера'));
check(Boolean(cameraRow), 'в списке оборудования есть камера');
if (cameraRow) {
  const selectedId = cameraRow.getAttribute('data-id') || '';
  const selectedNumber = (cameraRow.querySelector('strong')?.textContent || '').trim();
  cameraRow.click();
  await sleep(300);
  const markerNode = () => document.querySelector(`[data-object="equipment"][data-id="${selectedId}"]`);
  const defaultColor = (markerNode()?.getAttribute('data-color') || '').toLowerCase();
  check(/^#[0-9a-f]{6}$/.test(defaultColor), `у выбранной камеры дефолтный data-color: ${defaultColor}`);
  check((markerNode()?.textContent || '').includes(selectedNumber), `номер оборудования «${selectedNumber}» виден рядом с иконкой`);
  const propertiesText = document.querySelector('.properties')?.textContent || '';
  check(propertiesText.includes('Иконка'), 'в свойствах оборудования есть блок «Иконка»');
  check(propertiesText.includes('Камера'), 'подпись иконки показывает тип: Камера');
  check(propertiesText.includes('Цвет иконки'), 'в свойствах есть блок «Цвет иконки»');
  check(propertiesText.includes('По умолчанию'), 'есть кнопка «По умолчанию»');
  check(propertiesText.includes('По умолчанию цвет зависит от типа оборудования'), 'показано пояснение про хранение цвета в проекте');
  const swatches = Array.from(document.querySelectorAll('.color-swatch'));
  check(swatches.length >= 8, `кнопок-образцов цвета не меньше 8: ${swatches.length}`);
  check(Boolean(document.querySelector('.color-swatch.active')), 'текущий цвет отмечен активным образцом');
  const customColor = document.querySelector('input[aria-label="Свой цвет иконки"]');
  check(Boolean(customColor) && (customColor.value || '').toLowerCase() === defaultColor, `поле «Свой цвет иконки» показывает текущий цвет: ${customColor?.value || '—'}`);
  const alternative = swatches.find(button => (button.getAttribute('aria-label') || '').trim().toLowerCase() !== `цвет ${defaultColor}`);
  check(Boolean(alternative), 'есть образец цвета, отличный от текущего');
  if (alternative) {
    const expected = (alternative.getAttribute('aria-label') || '').replace('Цвет', '').trim().toLowerCase();
    alternative.click();
    await sleep(250);
    check((markerNode()?.getAttribute('data-color') || '').toLowerCase() === expected, `клик по образцу меняет data-color маркера: ${markerNode()?.getAttribute('data-color')} (ожидали ${expected})`);
    const reset = document.querySelector('.color-default');
    if (reset) {
      reset.click();
      await sleep(250);
      check((markerNode()?.getAttribute('data-color') || '').toLowerCase() === defaultColor, `«По умолчанию» возвращает цвет типа: ${markerNode()?.getAttribute('data-color')}`);
    }
  }
}

console.log('\n6d. Документ, печать и обмен');
const openExportSheet = async () => {
  const trigger = buttons().find(button => (button.textContent || '').includes('Экспорт / копия'));
  if (trigger) trigger.click();
  await sleep(220);
};
const closeSheets = async () => {
  Array.from(document.querySelectorAll('.sheet-head button[aria-label="Закрыть"]')).forEach(button => button.click());
  await sleep(150);
};
await openExportSheet();
const documentLabels = Array.from(document.querySelectorAll('.document-fields label')).map(label => label.textContent || '');
check(Boolean(document.querySelector('.document-fields')), 'в панели экспорта есть поля титульного листа');
for (const label of ['Организация', 'Объект', 'Шифр документа', 'Город', 'Заголовок документа']) {
  check(documentLabels.some(text => text.includes(label)), `в титульном листе есть поле «${label}»`);
}
check(Boolean(document.querySelector('.change-add')), 'в панели есть кнопка «＋ Изменение»');
const changeRowsBefore = document.querySelectorAll('.change-row').length;
document.querySelector('.change-add').click();
await sleep(220);
const changeRowsAfter = document.querySelectorAll('.change-row').length;
check(changeRowsAfter === changeRowsBefore + 1, `лист изменений: добавлена строка (${changeRowsBefore} → ${changeRowsAfter})`);
const orgLabel = Array.from(document.querySelectorAll('.document-fields label')).find(label => (label.textContent || '').includes('Организация'));
const orgInput = orgLabel?.querySelector('input');
check(Boolean(orgInput), 'поле «Организация» редактируется');
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
if (orgInput) { setInputValue(orgInput, 'ООО Кабель-Тест'); await sleep(220); }
const sectionCheckboxes = Array.from(document.querySelectorAll('.section-checkbox'));
check(sectionCheckboxes.length >= 15, `чекбоксов разделов не меньше 15: ${sectionCheckboxes.length}`);
check(sectionCheckboxes.some(box => (box.parentElement?.textContent || '').includes('Спецификация КНС')), 'есть раздел «Спецификация КНС»');
check(sectionCheckboxes.length > 0 && sectionCheckboxes.every(input => input.checked), 'по умолчанию выбраны все разделы');
check(Boolean(document.querySelector('.print-selected')), 'кнопка «Печать выбранных разделов» есть');
check(Boolean(document.querySelector('.anooplan-save')), 'кнопка «Сохранить проект .anooplan» есть');
check(Array.from(document.querySelectorAll('.share-pdf, .share-xlsx, .share-anooplan')).length === 3, 'кнопки «Поделиться» показаны при наличии shareFile');
const anooplanBefore = saved.filter(file => file.name.endsWith('.anooplan')).length;
document.querySelector('.anooplan-save').click();
await sleep(900);
const anooplanFiles = saved.filter(file => file.name.endsWith('.anooplan'));
check(anooplanFiles.length === anooplanBefore + 1, `файл .anooplan сохранён через мост: ${anooplanFiles.map(file => file.name).pop() || '—'}`);
let anoPlanFile = null;
if (anooplanFiles.length) {
  try { anoPlanFile = JSON.parse(Buffer.from(anooplanFiles[anooplanFiles.length - 1].base64, 'base64').toString('utf8')); } catch { anoPlanFile = null; }
}
check(anoPlanFile?.format === 'anooplan', `JSON проекта имеет format==='anooplan': ${anoPlanFile?.format ?? '—'}`);
check(anoPlanFile?.project?.document?.organization === 'ООО Кабель-Тест', `организация из титула попала в файл: ${anoPlanFile?.project?.document?.organization ?? '—'}`);
check(Array.isArray(anoPlanFile?.project?.document?.changeLog) && anoPlanFile.project.document.changeLog.length === changeRowsAfter, 'лист изменений попал в файл проекта');
check(Array.isArray(anoPlanFile?.pdfs) && Array.isArray(anoPlanFile?.photos), 'в файле .anooplan есть массивы pdfs и photos');
Array.from(document.querySelectorAll('.section-checkbox')).filter(input => input.checked).forEach(input => input.click());
await sleep(220);
check(document.querySelectorAll('.section-checkbox:checked').length === 0, 'все разделы можно снять');
const printBeforeEmpty = printCalls.length;
document.querySelector('.print-selected')?.click();
await sleep(500);
check(printCalls.length === printBeforeEmpty, 'при пустом выборе печать не запускается');
check((document.querySelector('.statusbar')?.textContent || '').includes('Выберите хотя бы один раздел'), 'показано сообщение о выборе раздела для печати');
await openExportSheet();
const freshCheckboxes = Array.from(document.querySelectorAll('.section-checkbox'));
check(freshCheckboxes.length >= 13 && freshCheckboxes.every(input => !input.checked), 'панель печати помнит снятый выбор');
freshCheckboxes[0].click();
await sleep(220);
check((document.querySelector('.print-sections-count')?.textContent || '').includes('1 из 15'), `счётчик выбранных разделов: ${document.querySelector('.print-sections-count')?.textContent || '—'}`);
const printBeforeSubset = printCalls.length;
document.querySelector('.print-selected')?.click();
await sleep(2600);
check(printCalls.length === printBeforeSubset + 1, `печать выбранных разделов вызвала мост: ${printCalls.length - printBeforeSubset}`);
if (printCalls.length >= 2) {
  const fullSize = Buffer.from(printCalls[0].base64, 'base64').length;
  const subsetSize = Buffer.from(printCalls[printCalls.length - 1].base64, 'base64').length;
  check(subsetSize < fullSize, `PDF выбранных разделов меньше полного: ${subsetSize} < ${fullSize} байт`);
}
await openExportSheet();
const shareAnoButton = document.querySelector('.share-anooplan');
if (shareAnoButton) { shareAnoButton.click(); await sleep(900); }
const sharedAnoPlan = shareCalls.filter(call => call.name.endsWith('.anooplan')).pop();
check(Boolean(sharedAnoPlan), '«Поделиться .anooplan» передал файл в системный диалог');
check(sharedAnoPlan?.mime === 'application/vnd.anooplan.project', `MIME .anooplan: ${sharedAnoPlan?.mime ?? '—'}`);
await closeSheets();
check(typeof window.__anooplanOpenSharedProject === 'function', 'нативная оболочка может открыть .anooplan через __anooplanOpenSharedProject');
window.__anooplanOpenSharedProject('{ это не json');
await sleep(300);
check(Boolean(document.querySelector('.banner.error')), 'невалидный .anooplan показал ошибку');
check(Boolean(document.querySelector('.app-shell')), 'приложение не сломалось после невалидного файла');
const sharedPayload = {
  format: 'anooplan',
  formatVersion: 1,
  project: {
    schemaVersion: 2,
    id: 'shared-project-1',
    name: 'Общий проект',
    floors: [{ id: 'shared-floor-1', name: 'Этаж 1', elevation: 0, metersPerUnit: 0.05, page: 1, width: 1000, height: 700 }],
    equipment: [],
    routes: [],
    cables: [],
    pins: [],
    updatedAt: new Date().toISOString(),
    document: { organization: 'ООО Обмен' },
  },
  pdfs: [],
  photos: [],
  exportedAt: new Date().toISOString(),
};
window.__anooplanOpenSharedProject(JSON.stringify(sharedPayload));
await sleep(600);
const openedProjectName = document.querySelector('input[aria-label="Название проекта"]')?.value || '';
check(openedProjectName === 'Общий проект', `проект открыт из файла .anooplan: «${openedProjectName}»`);
check((document.querySelector('.statusbar')?.textContent || '').includes('открыт из файла'), 'показано сообщение об открытии проекта из файла');
const saveButtonAfterOpen = document.querySelector('.top-actions button.primary');
check((saveButtonAfterOpen?.textContent || '').trim() === 'Сохранить', `открытый из файла проект не помечен сохранённым на сервере: ${(saveButtonAfterOpen?.textContent || '—').trim()}`);
check(!saveButtonAfterOpen?.disabled, 'кнопка «Сохранить» для открытого файла доступна');
window.__anooplanOpenSharedProject(JSON.stringify(sharedPayload));
await sleep(400);
check((document.querySelector('input[aria-label="Название проекта"]')?.value || '') === 'Общий проект', 'повторное открытие .anooplan не ломает загрузку');
check(Boolean(document.querySelector('.app-shell')) && Boolean(document.querySelector('.statusbar')), 'приложение работает после повторного открытия файла');

console.log('\n8. Выход с сохранением (кнопка «Назад» в Android)');
const saveAndExit = window.__anooplanSaveAndExit;
check(typeof saveAndExit === 'function', 'оболочке доступна функция saveAndExit');
if (typeof saveAndExit === 'function') {
  await saveAndExit();
  check(exitCalled, 'после сохранения запрошен выход');

  // P0: ошибка записи не должна закрывать приложение.
  const originalSetItem = window.localStorage.setItem;
  exitCalled = false;
  Object.defineProperty(window.localStorage, 'setItem', { configurable: true, value: () => { throw new Error('QuotaExceededError'); } });
  await saveAndExit();
  check(!exitCalled, 'ошибка сохранения не закрывает приложение');
  Object.defineProperty(window.localStorage, 'setItem', { configurable: true, value: originalSetItem });
}

check(reactWarnings.length === 0, `нет предупреждений React (найдено ${reactWarnings.length})`);
console.log(`\nИтог: ${failures.length ? 'ПРОВАЛ' : 'УСПЕХ'}`);
if (failures.length) {
  failures.forEach(item => console.log(' - ' + item));
  process.exit(1);
}
// Приложение держит таймеры (автоснимки, автосохранение) — завершаем тест явно.
process.exit(0);
