import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import type { Project } from '../src/model';
import { collectStorageGarbage } from '../src/garbage-collector';
import { AUTOSAVE_KEY } from '../src/local-projects';
import { idbDelete, idbGet, idbPut } from '../src/idb';
import { baseProject, device, floor } from './fixtures';

const project = (pdf: string, photo: string): Project => baseProject({
  id: 'gc-test', name: 'GC',
  floors: [floor('f1', { name: 'Этаж', metersPerUnit: 1, pdfId: `idb:${pdf}` })],
  equipment: [device('e1', 0, { number: 'E1', name: 'Камера', type: 'Камера', height: null, properties: {}, photos: [photo] })],
  routes: [], cables: [], pins: [],
});

test('GC сохраняет вложения проекта из черновика другой вкладки', async () => {
  const suffix = Date.now();
  const draftPdf = `draft-pdf-${suffix}`;
  const draftPhoto = `draft-photo-${suffix}`;
  const draft = project(draftPdf, draftPhoto);
  draft.id = `draft-${suffix}`;
  await idbPut(draftPdf, new Blob(['draft']));
  await idbPut('photo:' + draftPhoto, new Blob(['draft-photo']));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => key === AUTOSAVE_KEY ? JSON.stringify(draft) : null, setItem: () => { /* not used */ } },
  });
  try {
    await collectStorageGarbage([]);
    assert.ok(await idbGet(draftPdf));
    assert.ok(await idbGet('photo:' + draftPhoto));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    for (const key of [draftPdf, 'photo:' + draftPhoto]) await idbDelete(key);
  }
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
