/**
 * Self-test плагина без запуска DSH: регистрирует инструменты в фейковом ctx
 * и проверяет APK из build/. Запуск: node dsh/plugins/dsh-anooplan-tools/selftest.mjs
 */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './lib/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tools = [];
apply({ tools: { register: tool => tools.push(tool) } }, { root: repoRoot });

const names = tools.map(tool => tool.name);
assert.deepEqual(names, [
  'anooplan_apk_check',
  'anooplan_android_check',
  'anooplan_visual_check',
  'anooplan_release_status',
]);

for (const tool of tools) {
  assert.equal(typeof tool.description, 'string');
  assert.equal(typeof tool.execute, 'function');
  assert.equal(tool.parameters.type, 'object');
}

const apkTool = tools.find(tool => tool.name === 'anooplan_apk_check');
const result = await apkTool.execute({});
const data = JSON.parse(result.json);
assert.equal(data.ok, true, `APK не прошёл проверку: ${JSON.stringify(data.problems)}`);
assert.equal(data.checks.noInternetPermission, true);
assert.equal(data.checks.certificateMatches, true);
assert.ok(result.markdown.includes('Проверки:'));

console.log(`self-test OK: ${names.join(', ')}`);
console.log(`APK: ${data.apk}, ${data.versionName} (${data.versionCode}), ${data.sizeBytes} Б`);
