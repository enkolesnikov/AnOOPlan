import test from 'node:test';
import assert from 'node:assert/strict';
import type { Equipment, Pin, Project } from '../src/model';
import { referencedStorageKeys, unusedStorageKeys } from '../src/storage-gc';

const device = (id: string, photos: string[]): Equipment => ({
  id, number: id, name: id, type: 'Камера', floorId: 'f1',
  x: 0, y: 0, height: null, note: '', properties: {}, photos,
});

const pin = (photos: string[]): Pin => ({ id: 'z1', number: 'З-1', floorId: 'f1', x: 1, y: 2, comment: '', status: 'open', photos, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });

function project(id = 'p', pdf = 'pdf-a', photos: string[] = ['p1'], pinPhotos: string[] = ['z1']): Project {
  return {
    schemaVersion: 2, id, name: id, updatedAt: '2026-01-01T00:00:00Z',
    floors: [{ id: 'f1', name: 'Этаж 1', elevation: 0, metersPerUnit: 0.1, page: 1, width: 1000, height: 700, pdfId: `idb:${pdf}` }],
    equipment: [device('e1', photos)],
    routes: [], cables: [], pins: [pin(pinPhotos)],
  };
}

test('ссылки собираются из этажей и фотографий', () => {
  const { pdfs, photos } = referencedStorageKeys([project('p', 'pdf-a', ['p1', 'p2'])]);
  assert.deepEqual([...pdfs], ['pdf-a']);
  assert.deepEqual([...photos].sort(), ['p1', 'p2', 'z1']);
});

test('GC удаляет только неиспользуемые PDF и фото', () => {
  const keys = ['pdf-a', 'pdf-old', 'photo:p1', 'photo:z1', 'photo:old'];
  assert.deepEqual(unusedStorageKeys(keys, [project()]).sort(), ['pdf-old', 'photo:old']);
});

test('GC учитывает сохранённые проекты, undo/redo и снимки', () => {
  const keys = ['pdf-a', 'pdf-b', 'pdf-c', 'pdf-d', 'photo:p1', 'photo:p2'];
  const current = project('p', 'pdf-a');
  const saved = project('saved', 'pdf-b');
  const undo = project('p', 'pdf-c');
  const snapshot = project('p', 'pdf-d', ['p1', 'p2']);
  assert.deepEqual(unusedStorageKeys(keys, [current, saved, undo, snapshot]), []);
});

test('пустое хранилище и проект без PDF не ломают GC', () => {
  assert.deepEqual(unusedStorageKeys([], [project()]), []);
  const noPdf = project('p');
  noPdf.floors[0].pdfId = undefined;
  assert.deepEqual(unusedStorageKeys(['pdf-a'], [noPdf]), ['pdf-a']);
});
