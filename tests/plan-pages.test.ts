import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAN_PAGES, planOverlayWarning, planPageTitle, planPagesToCapture } from '../src/plan-pages';
import { createDemoProject, demoPlanPdf } from '../src/demo';

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
