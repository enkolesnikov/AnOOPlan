import test from 'node:test';
import assert from 'node:assert/strict';
import { planRasterWidth } from '../src/plan-raster';
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
