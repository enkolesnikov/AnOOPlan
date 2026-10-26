/**
 * Self-test дополнения к @perrylink/dsh-github: релиз читается без токена.
 * Загрузка ассета здесь не вызывается (это меняет GitHub Release).
 */
import assert from 'node:assert/strict';
import { apply } from './lib/index.js';

const tools = [];
apply({ tools: { register: tool => tools.push(tool) } });
assert.deepEqual(tools.map(tool => tool.name), ['github_release', 'github_release_upload']);
const release = JSON.parse((await tools.find(tool => tool.name === 'github_release').execute({ tag: 'v2.6.0' })).json);
assert.equal(release.ok, true, JSON.stringify(release.problems));
assert.ok(release.assets.length >= 1);
console.log(`self-test OK: ${tools.map(tool => tool.name).join(', ')}, release ${release.tag} (${release.assets.length} assets)`);
