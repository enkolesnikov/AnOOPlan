import test from 'node:test';
import assert from 'node:assert/strict';
import { planRasterWidth, limitPlanRaster, planRasterWarning } from '../src/plan-raster';
import { PLAN_MAX_PIXELS } from '../src/render-plan';

test('растр плана: A4 получает ~150 dpi, A0 — заметно больше 1600 px', () => {
  const a4 = planRasterWidth(842, 595);
  const a0 = planRasterWidth(3370, 2384);
  assert.ok(a4 >= 1600);
  assert.equal(a4, 1754);
  assert.ok(a0 > 2000);
  assert.ok(a0 > a4);
});

test('растр плана: два canvas не превышают общий бюджет памяти', () => {
  for (const [w, h] of [[842, 595], [3370, 2384], [2384, 3370]]) {
    const width = planRasterWidth(w, h);
    const layer = width * (width * h / Math.max(1, w));
    assert.ok(width * (width * h / Math.max(1, w)) + layer <= PLAN_MAX_PIXELS + 2, `${w}×${h}: ${width}`);
  }
});

test('растр плана: маленький лист не становится меньше 1600 px', () => {
  assert.equal(planRasterWidth(200, 200), 1600);
});

test('растр плана: вытянутый лист не пробивает бюджет памяти', () => {
  for (const [w, h] of [[500, 20000], [200, 100000]]) {
    const width = planRasterWidth(w, h);
    const pixels = width * (width * h / w) * 2;
    assert.ok(pixels <= PLAN_MAX_PIXELS + 2, `${w}×${h}: ${pixels} > ${PLAN_MAX_PIXELS}`);
  }
});

test('вытянутый лист 1:10 уменьшается по бюджету памяти и возвращает предупреждение', () => {
  // Так считает fallbackPlan: ширина 1600 px, высота — по пропорциям листа.
  // При 1:10 это 25,6 Мпикс, больше бюджета; ширина должна уменьшиться.
  const fit = limitPlanRaster(1600, 1600 * 10);
  assert.equal(fit.limited, true);
  assert.ok(fit.width * fit.height <= PLAN_MAX_PIXELS, `пикселей: ${fit.width * fit.height}`);
  assert.ok(fit.width < 1600, `ширина должна уменьшиться: ${fit.width}`);
  const warning = planRasterWarning('Этаж 1', fit.width, fit.limited);
  assert.ok(warning, 'для вытянутого листа нужно предупреждение');
  assert.match(warning, /^План этажа «Этаж 1» уменьшен до \d+ px по бюджету памяти\.$/);
});

test('бюджет соблюдается, когда страница PDF вытянута сильнее листа', () => {
  // Высоты канв складываются: лист 0.1 к ширине и слой PDF 3.6 — их сумма даёт 29 600 px.
  const fit = limitPlanRaster(8000, 8000 * (0.1 + 3.6));
  assert.equal(fit.limited, true);
  assert.ok(fit.width * fit.height <= PLAN_MAX_PIXELS, `пикселей: ${fit.width * fit.height}`);
  assert.ok(planRasterWarning('Этаж 2', fit.width, fit.limited));
});

test('штатный лист уменьшать не нужно — предупреждения нет', () => {
  const fit = limitPlanRaster(1600, 1600 * 0.7);
  assert.equal(fit.limited, false);
  assert.equal(fit.width, 1600);
  assert.equal(fit.height, 1120);
  assert.equal(planRasterWarning('Этаж 1', fit.width, fit.limited), null);
});
