import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from './fixtures';

test('pdfjs-dist обновлён до версии без high-уязвимости (>= 6.2.108)', () => {
  const manifest = JSON.parse(readRepoFile('package.json'));
  assert.match(manifest.dependencies['pdfjs-dist'], /^\^6\./);
  const installed = JSON.parse(readRepoFile('node_modules/pdfjs-dist/package.json'));
  const [major, minor, patch] = installed.version.split('.').map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 108))), installed.version);
});
