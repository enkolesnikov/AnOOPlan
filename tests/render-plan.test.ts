import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackPlan, needsClipping, planMemoryWarning, planRender, PLAN_MAX_PIXELS } from '../src/render-plan';

const MAX = PLAN_MAX_PIXELS;
/** Допуск на округление канвы: полпикселя на сторону, то есть не больше 1 пикселя площади. */
const withinBudget = (width: number, height: number, maxPixels: number): boolean => width * height <= maxPixels + 1;

test('бюджет памяти рендера плана — 8 Мпикс (32 МБ RGBA)', () => {
  assert.equal(PLAN_MAX_PIXELS, 8_000_000);
});

test('A4 рисуется целиком, как раньше', () => {
  const plan = planRender({ sheetWidth: 842, sheetHeight: 595, zoom: 1, dpr: 2, viewWidth: 400, viewHeight: 800, panX: 0, panY: 0, maxPixels: MAX });
  assert.equal(plan.clipped, false);
  assert.equal(plan.clipX, 0);
  assert.equal(plan.clipY, 0);
  assert.equal(plan.scale, 2);
  assert.equal(plan.canvasWidth, 1684);
  assert.equal(plan.canvasHeight, 1190);
  assert.equal(needsClipping(842, 595, 2, MAX), false);
  assert.ok(withinBudget(plan.canvasWidth, plan.canvasHeight, MAX), `пикселей: ${plan.canvasWidth * plan.canvasHeight}`);
});

test('A1 при dpr 2 не влезает в бюджет и клипуется', () => {
  const sheetWidth = 2384;
  const sheetHeight = 1684;
  assert.equal(needsClipping(sheetWidth, sheetHeight, 2, MAX), true);
  const plan = planRender({ sheetWidth, sheetHeight, zoom: 4, dpr: 2, viewWidth: 400, viewHeight: 800, panX: -1000, panY: -2000, maxPixels: MAX });
  assert.equal(plan.clipped, true);
  assert.ok(plan.clipWidth < sheetWidth, 'видимая часть уже всего листа');
  assert.ok(plan.clipHeight < sheetHeight, 'видимая часть ниже всего листа');
  assert.ok(plan.scale <= 3);
});

test('A0 при большом зуме рендерится по видимой области и укладывается в бюджет памяти', () => {
  const sheetWidth = 9933;
  const sheetHeight = 7016;
  assert.equal(needsClipping(sheetWidth, sheetHeight, 2, MAX), true);
  const plan = planRender({ sheetWidth, sheetHeight, zoom: 4, dpr: 2, viewWidth: 400, viewHeight: 800, panX: -1000, panY: -2000, maxPixels: MAX });
  assert.equal(plan.clipped, true);
  assert.ok(withinBudget(plan.canvasWidth, plan.canvasHeight, MAX), `пикселей: ${plan.canvasWidth * plan.canvasHeight}`);
  assert.ok(plan.clipWidth < sheetWidth, 'видимая часть уже всего листа');
  // Видимая область действительно начинается около pan: 1000/4 = 250, минус запас 25%.
  assert.ok(plan.clipX >= 0 && plan.clipX < 300, `clipX: ${plan.clipX}`);
  assert.ok(plan.scale <= 3);
});

test('канва клипнутого плана не превышает бюджет при разных масштабах и видах', () => {
  const viewports = [
    { sheetWidth: 2384, sheetHeight: 1684, zoom: 8, dpr: 2, viewWidth: 360, viewHeight: 640, panX: -120, panY: -240 },
    { sheetWidth: 3370, sheetHeight: 2384, zoom: 1, dpr: 2, viewWidth: 900, viewHeight: 620, panX: -40, panY: -60 },
    { sheetWidth: 9933, sheetHeight: 7016, zoom: 0.05, dpr: 1, viewWidth: 1200, viewHeight: 900, panX: 0, panY: 0 },
    { sheetWidth: 2000, sheetHeight: 1000, zoom: 2, dpr: 1, viewWidth: 600, viewHeight: 400, panX: 0, panY: 0 },
  ];
  for (const input of viewports) {
    for (const maxPixels of [MAX, 1_000_000, 250_000]) {
      const plan = planRender({ ...input, maxPixels });
      assert.ok(withinBudget(plan.canvasWidth, plan.canvasHeight, maxPixels), `${input.sheetWidth}×${input.sheetHeight} при бюджете ${maxPixels}: пикселей ${plan.canvasWidth * plan.canvasHeight}`);
    }
  }
});

test('видимая область не выходит за границы листа и учитывает запас на панорамирование', () => {
  const plan = planRender({ sheetWidth: 2000, sheetHeight: 1000, zoom: 2, dpr: 1, viewWidth: 600, viewHeight: 400, panX: 0, panY: 0, maxPixels: 100_000 });
  assert.equal(plan.clipped, true);
  assert.equal(plan.clipX, 0);
  assert.equal(plan.clipY, 0);
  assert.ok(plan.clipWidth <= 2000);
  assert.ok(plan.clipHeight <= 1000);
  // Бюджет ниже нижней границы в 250 000 пикселей поднимается до неё — как в needsClipping.
  assert.ok(withinBudget(plan.canvasWidth, plan.canvasHeight, 250_000), `пикселей: ${plan.canvasWidth * plan.canvasHeight}`);
});

test('зум в центр угла не даёт отрицательных размеров канвы', () => {
  const plan = planRender({ sheetWidth: 500, sheetHeight: 500, zoom: 3, dpr: 2, viewWidth: 800, viewHeight: 800, panX: 5000, panY: 5000, maxPixels: 100_000 });
  assert.ok(plan.canvasWidth >= 1 && plan.canvasHeight >= 1);
  assert.ok(plan.clipWidth >= 1 && plan.clipHeight >= 1);
});

test('резервный план всегда укладывается в бюджет', () => {
  const plan = fallbackPlan(9933, 7016, MAX);
  assert.equal(plan.clipped, false);
  assert.ok(withinBudget(plan.canvasWidth, plan.canvasHeight, MAX), `пикселей: ${plan.canvasWidth * plan.canvasHeight}`);
  assert.equal(plan.clipX, 0);
  const a0 = fallbackPlan(3370, 2384, MAX);
  assert.ok(withinBudget(a0.canvasWidth, a0.canvasHeight, MAX), `пикселей: ${a0.canvasWidth * a0.canvasHeight}`);
});

test('предупреждения для A4 нет: полный лист помещается в бюджет', () => {
  assert.equal(planMemoryWarning(842, 595, 2), null);
  assert.equal(planMemoryWarning(2384, 1684, 1), null);
});

test('A1 предупреждает про 8 Мпикс и рендер видимой области', () => {
  const warning = planMemoryWarning(2384, 1684, 2, MAX);
  assert.ok(warning, 'для A1 должно быть предупреждение');
  assert.match(warning, /A1/);
  assert.match(warning, /8\s*Мпикс/);
  assert.match(warning, /видим/);
  assert.match(warning, /Вписать/);
});

test('крупный растровый лист тоже получает предупреждение', () => {
  const warning = planMemoryWarning(9933, 7016, 2, MAX);
  assert.ok(warning, 'для листа A1 в 300 dpi должно быть предупреждение');
  assert.match(warning, /A1/);
  assert.match(warning, /8\s*Мпикс/);
  assert.match(warning, /видим/);
});

test('предупреждение без стандартного формата называет размеры листа', () => {
  const warning = planMemoryWarning(5000, 4000, 2, MAX);
  assert.ok(warning);
  assert.match(warning, /5000×4000/);
  assert.doesNotMatch(warning, /Лист A[0-4]/);
});

test('порог предупреждения совпадает с needsClipping', () => {
  for (const [width, height, dpr] of [[842, 595, 2], [2384, 1684, 2], [3370, 2384, 1], [9933, 7016, 1], [1191, 842, 2]] as const) {
    assert.equal(planMemoryWarning(width, height, dpr, MAX) !== null, needsClipping(width, height, dpr, MAX), `${width}×${height} при dpr ${dpr}`);
  }
});
