import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAN_PAGES, planOverlayWarning, planPageTitle, planPagesToCapture, planSheetsForPdf } from '../src/plan-pages';
import type { Floor } from '../src/model';
import { createDemoProject, demoPlanPdf } from '../src/demo';

function floor(id: string, name: string, page: number): Floor {
  return { id, name, elevation: null, metersPerUnit: null, pdfId: 'shared.pdf', page, width: 1000, height: 700 };
}

test('название листа различает одно- и многостраничный этаж', () => {
  assert.equal(planPageTitle('Этаж 1', 1, 1), 'Этаж 1');
  assert.equal(planPageTitle('Этаж 1', 2, 3), 'Этаж 1 · лист 2');
});

test('лимит страниц плана применяется и не ломает пустой PDF', () => {
  assert.equal(planPagesToCapture(3), 3);
  assert.equal(planPagesToCapture(0), 0);
  assert.equal(planPagesToCapture(MAX_PLAN_PAGES + 5), MAX_PLAN_PAGES);
});


test('предупреждение, если страница этажа вне PDF или за лимитом выгрузки', () => {
  assert.equal(planOverlayWarning('Этаж 1', 1, 1, 1), null);
  assert.equal(planOverlayWarning('Этаж 2', 2, 1, 1), 'Этаж «Этаж 2»: выбранная страница 2 вне диапазона, оверлей не нанесён.');
  assert.equal(planOverlayWarning('Этаж 3', 15, 20, MAX_PLAN_PAGES), `Этаж «Этаж 3»: страница 15 не выгружена из-за лимита ${MAX_PLAN_PAGES}; оверлей не нанесён.`);
});

test('демо-проект: страницы всех этажей существуют в демо-PDF', () => {
  const data = demoPlanPdf();
  const pdf = atob(data.slice(data.indexOf(',') + 1));
  const count = Number(/\/Count\s+(\d+)/.exec(pdf)?.[1]);
  assert.equal(count, 1, 'демо-PDF должен оставаться одностраничным');
  for (const floor of createDemoProject().floors) {
    assert.ok(floor.page >= 1 && floor.page <= count, `${floor.name}: страница ${floor.page} из ${count}`);
    assert.equal(planOverlayWarning(floor.name, floor.page, count, count), null, `${floor.name}: оверлей должен наноситься`);
  }
});

test('общий PDF: каждый лист печатается один раз, оверлеи на своих страницах', () => {
  const layout = planSheetsForPdf([floor('f1', 'Этаж 1', 1), floor('f2', 'Этаж 2', 2)], 3);
  assert.equal(layout.capturedPages, 3);
  assert.equal(layout.sheets.length, 3, 'два этажа на трёх страницах — три листа, а не шесть');
  assert.deepEqual(layout.sheets.map(sheet => sheet.page), [1, 2, 3]);
  assert.deepEqual(layout.sheets.map(sheet => sheet.floor?.id ?? null), ['f1', 'f2', null]);
  assert.deepEqual(layout.sheets.map(sheet => sheet.overlay), [true, true, false]);
  assert.equal(layout.sheets[0].title, 'Этаж 1 · лист 1');
  assert.equal(layout.sheets[1].title, 'Этаж 2 · лист 2');
  assert.equal(layout.sheets[2].title, 'Подложка · лист 3');
  assert.deepEqual(layout.warnings, []);
});

test('два этажа на одной странице: оверлей первому, второму предупреждение', () => {
  const layout = planSheetsForPdf([floor('f1', 'Этаж 1', 1), floor('f2', 'Этаж 2', 1)], 1);
  const warning = 'Этаж «Этаж 2»: страница 1 уже занята этажом «Этаж 1», оверлей не нанесён.';
  assert.equal(layout.sheets.length, 1);
  assert.equal(layout.sheets[0].floor?.id, 'f1');
  assert.equal(layout.sheets[0].overlay, true);
  assert.deepEqual(layout.warnings, [warning]);
  assert.equal(layout.sheets[0].note, warning);
});

test('этаж со страницей вне диапазона: предупреждение и лист без оверлея', () => {
  const layout = planSheetsForPdf([floor('f1', 'Этаж 1', 5)], 2);
  assert.equal(layout.sheets.length, 2);
  assert.ok(layout.sheets.every(sheet => sheet.floor === null && !sheet.overlay));
  assert.deepEqual(layout.sheets.map(sheet => sheet.title), ['Этаж 1 · лист 1', 'Этаж 1 · лист 2']);
  assert.ok(layout.warnings.includes('Этаж «Этаж 1»: выбранная страница 5 вне диапазона, оверлей не нанесён.'));
});

test('один этаж с многостраничным PDF: оверлей на своей странице, остальное — подложка', () => {
  const layout = planSheetsForPdf([floor('f1', 'Этаж 1', 2)], 3);
  assert.deepEqual(layout.sheets.map(sheet => sheet.overlay), [false, true, false]);
  assert.equal(layout.sheets[1].floor?.id, 'f1');
  assert.deepEqual(layout.sheets.map(sheet => sheet.title), ['Этаж 1 · лист 1', 'Этаж 1 · лист 2', 'Этаж 1 · лист 3']);
  assert.deepEqual(layout.warnings, []);
});

test('лимит страниц плана: печатаются первые максимум страниц, остальное — предупреждения', () => {
  const layout = planSheetsForPdf([floor('f1', 'Этаж 1', 1), floor('f2', 'Этаж 2', MAX_PLAN_PAGES + 3)], MAX_PLAN_PAGES + 5);
  assert.equal(layout.capturedPages, MAX_PLAN_PAGES);
  assert.equal(layout.sheets.length, MAX_PLAN_PAGES);
  assert.equal(new Set(layout.sheets.map(sheet => sheet.page)).size, layout.sheets.length, 'страницы не повторяются');
  assert.ok(layout.warnings[0].includes(`показаны первые ${MAX_PLAN_PAGES} страниц из ${MAX_PLAN_PAGES + 5}`));
  assert.ok(layout.warnings.some(warning => warning.includes('не выгружена из-за лимита')));
});
