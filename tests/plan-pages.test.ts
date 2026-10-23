import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAN_PAGES, planPageTitle, planPagesToCapture } from '../src/plan-pages';

test('название листа различает одно- и многостраничный этаж', () => {
  assert.equal(planPageTitle('Этаж 1', 1, 1), 'Этаж 1');
  assert.equal(planPageTitle('Этаж 1', 2, 3), 'Этаж 1 · лист 2');
});

test('лимит страниц плана применяется и не ломает пустой PDF', () => {
  assert.equal(planPagesToCapture(3), 3);
  assert.equal(planPagesToCapture(0), 0);
  assert.equal(planPagesToCapture(MAX_PLAN_PAGES + 5), MAX_PLAN_PAGES);
});
