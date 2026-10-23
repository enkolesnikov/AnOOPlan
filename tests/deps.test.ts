import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('pdfjs-dist обновлён до версии без high-уязвимости (>= 6.2.108)', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(manifest.dependencies['pdfjs-dist'], /^\^6\./);
  const installed = JSON.parse(readFileSync(join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8'));
  const [major, minor, patch] = installed.version.split('.').map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 108))), installed.version);
});
