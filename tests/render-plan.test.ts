import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackPlan, needsClipping, planRender } from '../src/render-plan';

const MAX = 12_000_000;

test('A4 рисуется целиком, как раньше', () => {
  const plan = planRender({ sheetWidth: 842, sheetHeight: 595, zoom: 1, dpr: 2, viewWidth: 400, viewHeight: 800, panX: 0, panY: 0, maxPixels: MAX });
  assert.equal(plan.clipped, false);
  assert.equal(plan.clipX, 0);
  assert.equal(plan.clipY, 0);
  assert.equal(plan.scale, 2);
  assert.equal(plan.canvasWidth, 1684);
  assert.equal(plan.canvasHeight, 1190);
  assert.equal(needsClipping(842, 595, 2, MAX), false);
});

test('A0 при большом зуме рендерится по видимой области и укладывается в бюджет памяти', () => {
  const sheetWidth = 9933;
  const sheetHeight = 7016;
  assert.equal(needsClipping(sheetWidth, sheetHeight, 2, MAX), true);
  const plan = planRender({ sheetWidth, sheetHeight, zoom: 4, dpr: 2, viewWidth: 400, viewHeight: 800, panX: -1000, panY: -2000, maxPixels: MAX });
  assert.equal(plan.clipped, true);
  assert.ok(plan.canvasWidth * plan.canvasHeight <= MAX, `пикселей: ${plan.canvasWidth * plan.canvasHeight}`);
  assert.ok(plan.clipWidth < sheetWidth, 'видимая часть уже всего листа');
  // Видимая область действительно начинается около pan: 1000/4 = 250, минус запас 25%.
  assert.ok(plan.clipX >= 0 && plan.clipX < 300, `clipX: ${plan.clipX}`);
  assert.ok(plan.scale <= 3);
});

test('видимая область не выходит за границы листа и учитывает запас на панорамирование', () => {
  const plan = planRender({ sheetWidth: 2000, sheetHeight: 1000, zoom: 2, dpr: 1, viewWidth: 600, viewHeight: 400, panX: 0, panY: 0, maxPixels: 100_000 });
  assert.equal(plan.clipped, true);
  assert.equal(plan.clipX, 0);
  assert.equal(plan.clipY, 0);
  assert.ok(plan.clipWidth <= 2000);
  assert.ok(plan.clipHeight <= 1000);
});

test('зум в центр угла не даёт отрицательных размеров канвы', () => {
  const plan = planRender({ sheetWidth: 500, sheetHeight: 500, zoom: 3, dpr: 2, viewWidth: 800, viewHeight: 800, panX: 5000, panY: 5000, maxPixels: 100_000 });
  assert.ok(plan.canvasWidth >= 1 && plan.canvasHeight >= 1);
  assert.ok(plan.clipWidth >= 1 && plan.clipHeight >= 1);
});

test('резервный план всегда укладывается в бюджет', () => {
  const plan = fallbackPlan(9933, 7016, MAX);
  assert.equal(plan.clipped, false);
  assert.ok(plan.canvasWidth * plan.canvasHeight <= MAX);
  assert.equal(plan.clipX, 0);
});
