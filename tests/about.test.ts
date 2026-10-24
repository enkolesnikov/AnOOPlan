import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from './fixtures';

test('OFL для PT Sans встроен в приложение целиком', () => {
  const ofl = readRepoFile('src/assets/fonts/OFL.txt');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /Reserved Font Names "PT Sans"/);
  assert.match(ofl, /Copyright \(c\) 2010, ParaType/);
  assert.ok(ofl.includes('PERMISSION & CONDITIONS'));
});

test('экран «О программе» ссылается на OFL и версию из package.json', () => {
  const about = readRepoFile('src/About.tsx');
  const version = JSON.parse(readRepoFile('package.json')).version;
  assert.match(about, /OFL\.txt\?raw/);
  assert.match(about, /SIL Open Font License 1\.1/);
  assert.match(about, /packageInfo\.version/);
  assert.ok(version.length > 0);
});
