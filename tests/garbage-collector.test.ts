import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import type { Project } from '../src/model';
import { collectStorageGarbage } from '../src/garbage-collector';
import { idbDelete, idbGet, idbPut } from '../src/idb';

const project = (pdf: string, photo: string): Project => ({
  schemaVersion: 1, id: 'gc-test', name: 'GC', updatedAt: '2026-01-01T00:00:00Z',
  floors: [{ id: 'f1', name: 'Этаж', elevation: 0, metersPerUnit: 1, page: 1, width: 1000, height: 700, pdfId: 'idb:' + pdf }],
  equipment: [{ id: 'e1', number: 'E1', name: 'Камера', type: 'Камера', floorId: 'f1', x: 0, y: 0, height: null, note: '', properties: {}, photos: [photo] }],
  routes: [], cables: [],
});

test('GC удаляет PDF/фото, на которые нет ссылок, и сохраняет используемые', async () => {
  const suffix = Date.now();
  const livePdf = `live-pdf-${suffix}`;
  const oldPdf = `old-pdf-${suffix}`;
  const livePhoto = `live-photo-${suffix}`;
  const oldPhoto = `old-photo-${suffix}`;
  await idbPut(livePdf, new Blob(['live']));
  await idbPut(oldPdf, new Blob(['old']));
  await idbPut('photo:' + livePhoto, new Blob(['live-photo']));
  await idbPut('photo:' + oldPhoto, new Blob(['old-photo']));
  try {
    await collectStorageGarbage([project(livePdf, livePhoto)]);
    assert.ok(await idbGet(livePdf));
    assert.ok(await idbGet('photo:' + livePhoto));
    assert.equal(await idbGet(oldPdf), undefined);
    assert.equal(await idbGet('photo:' + oldPhoto), undefined);
  } finally {
    for (const key of [livePdf, oldPdf, 'photo:' + livePhoto, 'photo:' + oldPhoto]) await idbDelete(key);
  }
});
