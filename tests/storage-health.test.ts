import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, STORAGE_WARN_RATIO, storageHealth } from '../src/storage-health';

test('storageHealth: estimate возвращается с ratio', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage');
  Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 80, quota: 100 }) } });
  try {
    const health = await storageHealth();
    assert.deepEqual(health, { usage: 80, quota: 100, ratio: 0.8 });
    assert.equal(STORAGE_WARN_RATIO, 0.8);
  } finally {
    if (original) Object.defineProperty(globalThis.navigator, 'storage', original);
    else Reflect.deleteProperty(globalThis.navigator, 'storage');
  }
});

test('storageHealth: отсутствие estimate даёт null, а не падение', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage');
  Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: {} });
  try { assert.equal(await storageHealth(), null); }
  finally {
    if (original) Object.defineProperty(globalThis.navigator, 'storage', original);
    else Reflect.deleteProperty(globalThis.navigator, 'storage');
  }
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(1536), '1.5 КБ');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 МБ');
});
