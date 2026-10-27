import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { idbDelete, idbGet, idbOpen, idbPut, idbStoreDelete, idbStoreGet, idbStoreGetAll, idbStoreKeys, idbStorePut } from '../src/idb';

test('PDF-блобы сохраняются, читаются и удаляются', async () => {
  const key = 'test-pdf-' + Date.now();
  const blob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  await idbPut(key, blob);
  const stored = await idbGet(key);
  assert.ok(stored);
  assert.equal(await stored!.text(), '%PDF-1.4 test');
  await idbDelete(key);
  assert.equal(await idbGet(key), undefined);
});

test('хранилище снимков: put/get/getAll/keys/delete', async () => {
  const key = 'test-snapshot-' + Date.now();
  await idbStorePut('snapshots', key, { key, value: 42 });
  assert.deepEqual(await idbStoreGet('snapshots', key), { key, value: 42 });
  assert.ok((await idbStoreKeys('snapshots')).includes(key));
  const all = await idbStoreGetAll<{ key: string }>('snapshots');
  assert.ok(all.some(item => item.key === key));
  await idbStoreDelete('snapshots', key);
  assert.equal(await idbStoreGet('snapshots', key), undefined);
});

test('соединение IndexedDB переиспользуется, а не открывается на каждую операцию', async () => {
  const first = await idbOpen();
  const second = await idbOpen();
  assert.equal(first, second);
  assert.equal(first.name, 'cableplan');
});
