import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneValue, createUuid, jsonClone, uuidFallback } from '../src/compat';
import '../src/polyfills';

test('uuidFallback собирает UUID v4 из getRandomValues', () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
  assert.equal(uuidFallback(() => bytes), '00010203-0405-4607-8809-0a0b0c0d0e0f');
});

test('createUuid возвращает UUID v4 и в Node, и через фолбэк', () => {
  const withNative = createUuid();
  assert.match(withNative, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // В старом WebView crypto.randomUUID отсутствует — проверяем сам генератор.
  const fallback = uuidFallback();
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(withNative, fallback);
});

test('cloneValue и jsonClone делают независимую глубокую копию проекта', () => {
  const source = { name: 'Проект', floors: [{ id: 'f1', width: 100 }] };
  for (const clone of [cloneValue, jsonClone]) {
    const copy = clone(source);
    assert.deepEqual(copy, source);
    assert.notEqual(copy, source);
    copy.floors[0].width = 200;
    assert.equal(source.floors[0].width, 100);
  }
});

test('index.html показывает экран «обновите WebView» ещё до загрузки бандла', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="webview-warning"/);
  assert.ok(html.includes('Chrome\\/(\\d+)'));
  assert.ok(html.includes('Number(match[1]) < 98'));
  assert.match(html, /indexedDB/);
  assert.match(html, /Обновите системный WebView/);
});

test('полифилл Promise.withResolvers работает и не ломает нативный', async () => {
  const method = (Promise as unknown as { withResolvers?: unknown }).withResolvers;
  assert.equal(typeof method, 'function');
  const deferred = (Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T) => void } }).withResolvers<string>();
  deferred.resolve('готово');
  assert.equal(await deferred.promise, 'готово');
});
