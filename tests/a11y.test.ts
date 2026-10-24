import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  TEXT_ZOOM_DEFAULT,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  resolveTextZoom,
  resolveThemeColor,
} from '../src/a11y';

test('textZoom: границы и значение по умолчанию — 85/100/160 %', () => {
  assert.equal(TEXT_ZOOM_MIN, 85);
  assert.equal(TEXT_ZOOM_MAX, 160);
  assert.equal(TEXT_ZOOM_DEFAULT, 100);
  assert.equal(FONT_SCALE_MIN, 0.85);
  assert.equal(FONT_SCALE_MAX, 1.6);
  // Системный шрифт «по умолчанию», «мелкий» и «очень крупный» из настроек Android.
  assert.equal(resolveTextZoom(0.85), 85);
  assert.equal(resolveTextZoom(1), 100);
  assert.equal(resolveTextZoom(1.6), 160);
});

test('textZoom: дробный fontScale округляется до целого процента', () => {
  assert.equal(resolveTextZoom(0.9), 90);
  assert.equal(resolveTextZoom(1.004), 100);
  assert.equal(resolveTextZoom(1.006), 101);
  assert.equal(resolveTextZoom(1.234), 123);
  assert.equal(resolveTextZoom(1.236), 124);
  assert.equal(resolveTextZoom(1.155), 116);
});

test('textZoom: выход за диапазон зажимается в 85–160 %', () => {
  assert.equal(resolveTextZoom(0.5), TEXT_ZOOM_MIN);
  assert.equal(resolveTextZoom(0.001), TEXT_ZOOM_MIN);
  assert.equal(resolveTextZoom(2), TEXT_ZOOM_MAX);
  assert.equal(resolveTextZoom(1.605), TEXT_ZOOM_MAX);
  assert.equal(resolveTextZoom(10), TEXT_ZOOM_MAX);
});

test('textZoom: некорректный fontScale даёт 100 % и не ломает WebView', () => {
  const garbage = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined,
    '1.3', '100', '', true, false, -1, -0.5, 0, -0, {}, [], () => 1];
  for (const value of garbage) {
    assert.equal(resolveTextZoom(value), TEXT_ZOOM_DEFAULT, `fontScale=${String(value)}`);
  }
});

test('theme-color: светлая и тёмная системная тема', () => {
  assert.match(THEME_COLOR_LIGHT, /^#[0-9a-f]{6}$/);
  assert.match(THEME_COLOR_DARK, /^#[0-9a-f]{6}$/);
  assert.notEqual(THEME_COLOR_LIGHT, THEME_COLOR_DARK);
  assert.equal(resolveThemeColor(false), THEME_COLOR_LIGHT);
  assert.equal(resolveThemeColor(true), THEME_COLOR_DARK);
});
