import test from 'node:test';
import assert from 'node:assert/strict';
import { installApiTokenFromUrl } from '../src/api-token';

test('токен из ссылки сохраняется в cookie и убирается из адреса', () => {
  const saved: string[] = [];
  const cookie = { set cookie(value: string) { saved.push(value); } } as unknown as Document;
  const replaced: string[] = [];
  const original = globalThis.window;
  Object.assign(globalThis, {
    window: {
      location: { pathname: '/AnOOPlan/app/', hash: '#plan' },
      history: { replaceState: (_state: unknown, _title: string, url: string) => { replaced.push(url); } },
    },
  });
  try {
    assert.equal(installApiTokenFromUrl('?token=abc%20123&x=1', cookie), true);
    assert.deepEqual(saved, ['anooplan_token=abc%20123; path=/; SameSite=Strict']);
    assert.deepEqual(replaced, ['/AnOOPlan/app/?x=1#plan']);
  } finally {
    if (original) Object.assign(globalThis, { window: original });
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('без токена адрес не меняется', () => {
  const cookie = { set cookie(_value: string) { throw new Error('не должно вызываться'); } } as unknown as Document;
  assert.equal(installApiTokenFromUrl('?x=1', cookie), false);
});
