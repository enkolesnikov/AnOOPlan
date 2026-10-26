/**
 * Self-test GitHub-инструментов (публичное чтение без токена).
 * Запуск: node dsh/plugins/dsh-github-tools/selftest.mjs
 */
import assert from 'node:assert/strict';
import { apply } from './lib/index.js';

const tools = [];
apply({ tools: { register: tool => tools.push(tool) } });
assert.deepEqual(tools.map(tool => tool.name), [
  'github_release', 'github_release_upload', 'github_workflow_runs', 'github_issues',
]);

const release = JSON.parse((await tools.find(tool => tool.name === 'github_release').execute({ tag: 'v2.5.0' })).json);
assert.equal(release.ok, true, JSON.stringify(release.problems));
assert.ok(release.assets.length >= 1);

const runs = JSON.parse((await tools.find(tool => tool.name === 'github_workflow_runs').execute({ limit: 3 })).json);
assert.equal(runs.ok, true, JSON.stringify(runs.problems));
assert.ok(Array.isArray(runs.runs));

const issues = JSON.parse((await tools.find(tool => tool.name === 'github_issues').execute({ limit: 5 })).json);
assert.equal(issues.ok, true, JSON.stringify(issues.problems));

console.log(`self-test OK: release ${release.tag} (${release.assets.length} assets), runs ${runs.runs.length}, issues ${issues.issues.length}`);
