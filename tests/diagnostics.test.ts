import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDiagnostics, diagnosticsText, logDiagnostic, readDiagnostics, type DiagnosticStorage } from '../src/diagnostics';

function fakeStorage(): DiagnosticStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

test('журнал хранит последние 50 записей и переживает мусор в хранилище', () => {
  const storage = fakeStorage();
  for (let index = 0; index < 55; index += 1) logDiagnostic('message', `ошибка ${index}`, 'test', storage);
  const entries = readDiagnostics(storage);
  assert.equal(entries.length, 50);
  assert.equal(entries[0].message, 'ошибка 5');
  assert.equal(entries.at(-1)?.message, 'ошибка 54');
  storage.setItem('cableplan:diagnostics', 'не json');
  assert.deepEqual(readDiagnostics(storage), []);
});

test('ошибка сохраняет сообщение и стек, контекст и текст экспорта', () => {
  const storage = fakeStorage();
  const error = new Error('PDF не отрисован');
  logDiagnostic('error', error, 'capturePlan', storage);
  const [entry] = readDiagnostics(storage);
  assert.equal(entry.message, 'PDF не отрисован');
  assert.equal(entry.context, 'capturePlan');
  assert.ok(entry.stack?.includes('diagnostics.test'));
  const text = diagnosticsText('1.9.0', storage);
  assert.ok(text.includes('Версия приложения: 1.9.0'));
  assert.ok(text.includes('PDF не отрисован'));
  assert.ok(text.includes('[error]'));
  clearDiagnostics(storage);
  assert.deepEqual(readDiagnostics(storage), []);
});

test('журнал не падает при недоступном хранилище', () => {
  assert.doesNotThrow(() => logDiagnostic('error', new Error('нет места'), 'test', null));
  assert.deepEqual(readDiagnostics(null), []);
});
