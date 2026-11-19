import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import type { Project } from '../src/model';
import { collectStorageGarbage } from '../src/garbage-collector';
import { idbDelete, idbGet, idbPut } from '../src/idb';
import { baseProject, device } from './fixtures';

/**
 * Сценарий «удалить → undo → Blob жив»: коллектор мусора не должен удалять
 * вложение, пока на него ссылается хотя бы одно состояние — текущее, undo
 * или redo. Как только ссылок не осталось, блоб удаляется.
 */

const PHOTO_KEY = 'photo:k1';

// Пустое localStorage: иначе сохранённые проекты или черновик из окружения
// удержат блоб и тест перестанет проверять undo.
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => { /* не используется */ } },
  configurable: true,
});

test('blob-undo: фото переживает undo после удаления объекта и удаляется без ссылок', async () => {
  await idbPut(PHOTO_KEY, new Blob(['photo-bytes'], { type: 'image/jpeg' }));

  const before: Project = baseProject({
    id: 'blob-undo',
    name: 'До удаления',
    equipment: [device('e1', 0, { photos: ['k1'] })],
  });
  // «Удаление» объекта: фото-ссылка исчезает из текущего состояния.
  const restored: Project = { ...before, equipment: [] };
  const undo: Project[] = [before];
  const redo: Project[] = [];

  try {
    assert.ok(await idbGet(PHOTO_KEY), 'блоб записан');

    await collectStorageGarbage([restored, ...undo, ...redo]);
    const kept = await idbGet(PHOTO_KEY);
    assert.ok(kept, 'GC обязан сохранить блоб из undo');
    assert.equal(await kept!.text(), 'photo-bytes');

    // Undo-история пропала (новая правка/перезагрузка) — ссылок на фото нет.
    await collectStorageGarbage([restored]);
    assert.equal(await idbGet(PHOTO_KEY), undefined, 'без ссылок блоб удаляется');
  } finally {
    await idbDelete(PHOTO_KEY);
  }
});
