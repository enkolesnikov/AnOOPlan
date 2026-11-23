import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_BACKUP_EVERY,
  bumpSaveCounter,
  isBackupDue,
  resetSaveCounter,
  saveCounter,
  type CounterStorage,
} from '../src/auto-backup';

function storage(): CounterStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

test('каждое N-е сохранение запрашивает резервную копию', () => {
  const store = storage();
  const due: number[] = [];
  for (let index = 0; index < AUTO_BACKUP_EVERY * 2 + 3; index += 1) {
    const counter = bumpSaveCounter('p1', store);
    if (isBackupDue(counter)) due.push(counter);
  }
  assert.deepEqual(due, [AUTO_BACKUP_EVERY, AUTO_BACKUP_EVERY * 2]);
});

test('счётчики проектов независимы и сбрасываются при удалении', () => {
  const store = storage();
  bumpSaveCounter('p1', store);
  bumpSaveCounter('p1', store);
  bumpSaveCounter('p2', store);
  assert.equal(saveCounter('p1', store), 2);
  assert.equal(saveCounter('p2', store), 1);
  resetSaveCounter('p1', store);
  assert.equal(saveCounter('p1', store), 0);
  assert.equal(saveCounter('p2', store), 1, 'соседний проект не пострадал');
});

test('мусор в хранилище читается как 0', () => {
  const store = storage();
  store.setItem('cableplan:save-count:p1', 'не число');
  assert.equal(saveCounter('p1', store), 0);
  store.setItem('cableplan:save-count:p1', '-5');
  assert.equal(saveCounter('p1', store), 0);
});

test('недоступное хранилище не ломает сохранение', () => {
  assert.equal(saveCounter('p1', null), 0);
  assert.equal(bumpSaveCounter('p1', null), 1);
  resetSaveCounter('p1', null);
});
