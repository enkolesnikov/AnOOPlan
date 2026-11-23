import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MODE_KEY, lockPortraitOrientation, readFieldMode, unlockOrientation, writeFieldMode, type FlagStorage } from '../src/field-mode';

function storage(): FlagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

test('полевой режим по умолчанию выключен, флаг переживает запись', () => {
  const store = storage();
  assert.equal(readFieldMode(store), false);
  writeFieldMode(true, store);
  assert.equal(store.getItem(FIELD_MODE_KEY), '1');
  assert.equal(readFieldMode(store), true);
  writeFieldMode(false, store);
  assert.equal(readFieldMode(store), false);
});

test('мусор в хранилище читается как «выключено»', () => {
  const store = storage();
  store.setItem(FIELD_MODE_KEY, 'да-да');
  assert.equal(readFieldMode(store), false);
  assert.equal(readFieldMode(null), false, 'нет хранилища — нет режима');
  writeFieldMode(true, null); // не бросает
});

test('фиксация ориентации без Screen Orientation API — тихий отказ', async () => {
  // В Node screen нет: функции обязаны завершаться, а не падать.
  assert.equal(await lockPortraitOrientation(), false);
  await unlockOrientation();
});
