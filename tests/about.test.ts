import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('OFL для PT Sans встроен в приложение целиком', () => {
  const ofl = readFileSync(join(root, 'src/assets/fonts/OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /Reserved Font Names "PT Sans"/);
  assert.match(ofl, /Copyright \(c\) 2010, ParaType/);
  assert.ok(ofl.includes('PERMISSION & CONDITIONS'));
});

test('экран «О программе» ссылается на OFL и версию из package.json', () => {
  const about = readFileSync(join(root, 'src/About.tsx'), 'utf8');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.match(about, /OFL\.txt\?raw/);
  assert.match(about, /SIL Open Font License 1\.1/);
  assert.match(about, /packageInfo\.version/);
  assert.ok(version.length > 0);
});
