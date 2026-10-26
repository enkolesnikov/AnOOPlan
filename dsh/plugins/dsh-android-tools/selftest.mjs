/**
 * Self-test дополнения к @zseven-w/dsh-android: регистрация двух инструментов.
 * Установка APK и тема проверяются на устройстве, не здесь.
 */
import assert from 'node:assert/strict';
import { apply } from './lib/index.js';

const tools = [];
apply({ tools: { register: tool => tools.push(tool) } });
assert.deepEqual(tools.map(tool => tool.name), ['android_install', 'android_set']);
for (const tool of tools) {
  assert.equal(typeof tool.description, 'string');
  assert.equal(typeof tool.execute, 'function');
  assert.equal(tool.parameters.type, 'object');
}
console.log(`self-test OK: ${tools.map(tool => tool.name).join(', ')}`);
