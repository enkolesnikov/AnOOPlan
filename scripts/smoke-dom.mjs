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
let exitCalled = false;
let vibrations = 0;
const printCalls = [];
window.AnOOPlanNative = {
  platform: () => 'android',
  saveFile: (name, base64, mime) => {
    saved.push({ name, base64, mime });
    return 'ok:Download/AnOOPlan/' + name;
  },
  setDirty: value => dirtyStates.push(value),
  exitNow: () => { exitCalled = true; },
  vibrate: () => { vibrations += 1; },
  printPdf: (name, base64) => { printCalls.push({ name, base64 }); },
};

// Шрифты для PDF приложение тянет из собственных ассетов — отдаём их как статический сервер.
const FONT_DIR = join(ROOT, 'src', 'assets', 'fonts');
const FONT_FILES = ['PT_Sans-Web-Regular.ttf', 'PT_Sans-Web-Bold.ttf'];
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
const printButton = buttons().find(button => (button.textContent || '').trim() === 'Печать A4');
check(Boolean(printButton), 'кнопка «Печать A4» доступна в приложении');
if (printButton) {
  printButton.click();
  await sleep(2500);
  check(printCalls.length === 1, `мост печати вызван: ${printCalls.length}`);
  if (printCalls.length) {
    const bytes = Buffer.from(printCalls[0].base64, 'base64');
    check(bytes.subarray(0, 5).toString() === '%PDF-', 'в печать ушёл корректный PDF');
    check(printCalls[0].name.length > 0, `имя задания: ${printCalls[0].name}`);
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
  const diameterField = Array.from(document.querySelectorAll('.properties label')).find(label => (label.textContent || '').includes('Внешний диаметр, мм'));
  const diameterInput = diameterField?.querySelector('input');
  const diameterValue = Number((diameterInput?.value || '').replace(',', '.'));
  check(Number.isFinite(diameterValue) && diameterValue > 0, `демо-кабель имеет диаметр (${diameterInput?.value || '—'})`);
  const calculationText = document.querySelector('.calculation-card')?.textContent || '';
  check(calculationText.includes('Сечение') && calculationText.includes('мм²'), 'в расчёте кабеля показано сечение, мм²');
  check(calculationText.includes('Заполнение лотка'), 'в расчёте кабеля показано заполнение лотка');
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
check(routeLabels.some(text => text.includes('Ширина лотка, мм')), 'в свойствах трассы есть поле «Ширина лотка, мм»');
check(routeLabels.some(text => text.includes('Высота борта, мм')), 'в свойствах трассы есть поле «Высота борта, мм»');
check(routeLabels.some(text => text.includes('Площадь лотка, мм²')), 'в свойствах трассы есть поле «Площадь лотка, мм²»');
const routeProperties = document.querySelector('.properties')?.textContent || '';
check(routeProperties.includes('Заполнение лотка'), 'в свойствах трассы есть блок «Заполнение лотка»');
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
const traySection = Array.from(document.querySelectorAll('.spec-section')).find(section => (section.querySelector('h2')?.textContent || '').includes('Заполнение лотков'));
check(Boolean(traySection), 'в ведомостях есть раздел «Заполнение лотков»');
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
// Приложение держит таймеры (автоснимки, автосохранение) — завершаем тест явно.
process.exit(0);
