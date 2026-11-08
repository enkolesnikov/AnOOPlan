import test from 'node:test';
import assert from 'node:assert/strict';
import { chainDimensions } from '../src/plan-edits';

test('цепочка размеров: пары соседних точек и один список', () => {
  const chain = chainDimensions(['a', 'b', 'c', 'd']);
  assert.equal(chain.length, 3);
  assert.deepEqual(chain.map(item => [item.fromId, item.toId]), [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  assert.equal(new Set(chain.map(item => item.id)).size, 3);
  assert.deepEqual(chainDimensions(['a']), []);
  assert.deepEqual(chainDimensions([]), []);
});
