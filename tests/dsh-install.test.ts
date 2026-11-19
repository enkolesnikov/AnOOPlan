import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Статические проверки dsh/install.mjs: запись профиля должна быть атомарной
 * (временный файл в том же каталоге + rename), без check-then-use
 * (CodeQL js/file-system-race). Сам установщик здесь не запускается: это
 * ESM-скрипт, который при импорте трогает ~/.dsh и зовёт dsh.
 */

const source = readFileSync(new URL('../dsh/install.mjs', import.meta.url), 'utf8');

test('dsh/install.mjs пишет профиль атомарно', () => {
  assert.match(source, /renameSync\(/, 'замена профиля через rename, а не перезапись поверх');
  assert.match(source, /openSync\([^)]*['"]wx['"]/, "временный файл открывается с 'wx' (O_CREAT|O_EXCL)");
  assert.match(source, /randomUUID\(/, 'уникальное имя временного файла');
  assert.match(source, /chmodSync\(/, 'права исходного файла выставляются после rename');
  assert.match(source, /fsyncSync\(/, 'содержимое сбрасывается на диск до rename');
});

test('dsh/install.mjs не использует check-then-use для профиля', () => {
  assert.ok(!source.includes('existsSync(profilePkgPath)'), 'нет existsSync(profilePkgPath) перед readFileSync');
  assert.ok(!source.includes('existsSync(plugin.link)'), 'нет existsSync(plugin.link) перед symlinkSync');
  assert.doesNotMatch(source, /writeFileSync\(\s*profilePkgPath/, 'запись идёт только во временный файл');
  assert.doesNotMatch(source, /copyFileSync\(\s*profilePkgPath/, 'копирование профиля не поверх цели');
  assert.doesNotMatch(source, /copyFileSync\(\s*backup/, 'откат — атомарная замена, а не copyFileSync поверх');
  assert.doesNotMatch(source, /existsSync/, 'в установщике не осталось проверок существования перед использованием');
});

test('dsh/install.mjs читает профиль и обрабатывает ENOENT', () => {
  assert.match(source, /readFileSync\(profilePkgPath/, 'профиль читается напрямую');
  assert.match(source, /error\.code === 'ENOENT'/, 'отсутствие профиля — ошибка ENOENT, остальное пробрасывается');
  assert.match(source, /fail\(`нет профиля \$\{profile\}/, 'текст ошибки про отсутствующий профиль сохранён');
});

test('dsh/install.mjs создаёт симлинки без предварительной проверки', () => {
  assert.match(source, /try\s*\{\s*symlinkSync\(plugin\.dir, plugin\.link, 'dir'\)/, 'symlink создаётся сразу');
  assert.match(source, /error\.code !== 'EEXIST'/, 'EEXIST разбирается после попытки создания');
  assert.match(source, /lstatSync\(plugin\.link\)\.isSymbolicLink\(\)/, 'не-симлинк на месте ссылки — ошибка');
});
