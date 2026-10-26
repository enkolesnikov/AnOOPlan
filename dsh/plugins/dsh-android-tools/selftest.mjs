/**
 * Self-test Android-обёртки без запуска DSH.
 * Запуск: node dsh/plugins/dsh-android-tools/selftest.mjs
 */
import assert from 'node:assert/strict';
import { apply } from './lib/index.js';

const tools = [];
apply({ tools: { register: tool => tools.push(tool) } });
assert.deepEqual(tools.map(tool => tool.name), [
  'android_devices', 'android_boot', 'android_install',
  'android_screenshot', 'android_set', 'android_logcat',
]);
const result = await tools.find(tool => tool.name === 'android_devices').execute({});
const data = JSON.parse(result.json);
assert.equal(data.ok, true, JSON.stringify(data.problems));
assert.ok(Array.isArray(data.devices));
console.log(`self-test OK: ${tools.length} tools, devices: ${data.devices.length}`);
