import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSnapshotKeys, snapshotKeyPrefix, snapshotProjectId, snapshotTimestamp } from '../src/snapshot-key';

test('snapshot-key: обычный ключ', () => {
  assert.equal(snapshotProjectId('proj-1:1700000000000'), 'proj-1');
  assert.equal(snapshotTimestamp('proj-1:1700000000000'), 1700000000000);
});

test('snapshot-key: двоеточие в id проекта не сдвигает границу', () => {
  assert.equal(snapshotProjectId('a:b:1700000000000'), 'a:b');
  assert.equal(snapshotTimestamp('a:b:1700000000000'), 1700000000000);
  assert.equal(snapshotProjectId('a:b:c:1700000000000'), 'a:b:c');
});

test('snapshot-key: проект «a» не получает снимки проекта «a:b»', () => {
  const keys = ['a:1', 'a:b:2', 'a:3', 'other:4', 'a:b:5'];
  assert.deepEqual(projectSnapshotKeys(keys, 'a'), ['a:3', 'a:1']);
  assert.deepEqual(projectSnapshotKeys(keys, 'a:b'), ['a:b:5', 'a:b:2']);
});

test('snapshot-key: мусорные ключи не попадают в проект', () => {
  assert.equal(snapshotProjectId('no-separator'), '');
  assert.ok(Number.isNaN(snapshotTimestamp('no-separator')));
  assert.deepEqual(projectSnapshotKeys(['no-separator', ':1', 'p:'], 'p'), ['p:']);
  assert.equal(snapshotKeyPrefix('p'), 'p:');
});
