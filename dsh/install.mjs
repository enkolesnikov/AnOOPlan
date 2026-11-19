#!/usr/bin/env node
/**
 * Установка локальных DSH-плагинов AnOOPlan в профиль.
 *
 * Для каждого каталога dsh/plugins/<name> с package.json:
 *   1) линкует его в ~/.dsh/local-plugins/<name>;
 *   2) добавляет link-зависимость в профиль (dsh plugin --profile <p> add);
 *   3) включает плагин в dsh.profile.bundles профиля (с резервной копией);
 *   4) проверяет, что dsh --dump-config видит все плагины, иначе откатывает bundle.
 *
 * Профиль и его резервная копия пишутся атомарно: содержимое уходит во временный
 * файл в том же каталоге (openSync с флагом 'wx' — O_EXCL), затем renameSync
 * поверх цели. Проверок «существует ли файл» перед записью нет, поэтому файл
 * не может подмениться между проверкой и использованием (js/file-system-race).
 *
 * Использование: node dsh/install.mjs [--profile web] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, readlinkSync, renameSync, statSync, symlinkSync, unlinkSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'dsh', 'plugins');
const argv = process.argv.slice(2);
const profileIndex = argv.indexOf('--profile');
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : 'web';
const dryRun = argv.includes('--dry-run');
const dshBin = process.env.DSH_BIN || 'dsh';
const home = process.env.HOME || homedir();

function log(message) {
  console.log(`[dsh:install] ${message}`);
}

function fail(message) {
  console.error(`[dsh:install] ${message}`);
  process.exit(1);
}

/**
 * Атомарная замена файла: временный файл создаётся эксклюзивно в том же
 * каталоге (openSync 'wx' = O_CREAT|O_EXCL, без проверки существования),
 * данные сбрасываются на диск, затем renameSync заменяет цель одним шагом.
 * Права выставляются после rename: umask мог урезать mode при создании.
 * При любой ошибке временный файл удаляется, цель остаётся нетронутой.
 */
function atomicWrite(targetPath, content, mode = 0o644) {
  const tmpPath = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`);
  let fd = null;
  let replaced = false;
  try {
    fd = openSync(tmpPath, 'wx', mode);
    writeSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmpPath, targetPath);
    replaced = true;
    chmodSync(targetPath, mode);
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // дескриптор уже закрыт — освобождать нечего
      }
    }
    if (!replaced) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // временного файла нет: openSync его не создал
      }
    }
  }
}

try {
  readFileSync(join(repoRoot, 'package.json'));
} catch (error) {
  if (error.code === 'ENOENT') fail(`${repoRoot} не похож на корень репозитория AnOOPlan`);
  throw error;
}

let pluginEntries;
try {
  pluginEntries = readdirSync(pluginRoot, { withFileTypes: true });
} catch (error) {
  if (error.code === 'ENOENT') fail(`нет каталога плагинов: ${pluginRoot}`);
  throw error;
}

const plugins = [];
for (const entry of pluginEntries) {
  if (!entry.isDirectory()) continue;
  const dir = join(pluginRoot, entry.name);
  let source;
  try {
    source = readFileSync(join(dir, 'package.json'), 'utf8');
  } catch (error) {
    // Каталог без package.json — просто не плагин.
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const pkg = JSON.parse(source);
  plugins.push({ dir, name: pkg.name, description: pkg.description ?? '' });
}
if (plugins.length === 0) fail('в dsh/plugins нет плагинов с package.json');

const localPlugins = join(home, '.dsh', 'local-plugins');
const links = plugins.map(plugin => ({ ...plugin, link: join(localPlugins, plugin.name) }));

if (dryRun) {
  log(`dsh=${dshBin}, профиль=${profile}, плагинов=${links.length}`);
  for (const plugin of links) log(`симлинк: ${plugin.link} -> ${plugin.dir}`);
  log(`команда: ${dshBin} plugin --profile ${profile} add ${links.map(plugin => `link:${plugin.link}`).join(' ')}`);
  log(`bundle: ${links.map(plugin => plugin.name).join(', ')}`);
  process.exit(0);
}

mkdirSync(localPlugins, { recursive: true });
for (const plugin of links) {
  try {
    symlinkSync(plugin.dir, plugin.link, 'dir');
    log(`симлинк создан: ${plugin.name}`);
  } catch (error) {
    // Ссылка уже есть: разбираемся по факту, без проверки «до».
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(plugin.link).isSymbolicLink()) {
      fail(`${plugin.link} существует и это не симлинк — не трогаю`);
    }
    const target = resolve(localPlugins, readlinkSync(plugin.link));
    if (target !== plugin.dir) fail(`${plugin.link} уже ведёт в ${target}; уберите его вручную`);
    log(`симлинк уже на месте: ${plugin.name}`);
  }
}

log(`добавляю link-зависимости в профиль ${profile}…`);
execFileSync(dshBin, ['plugin', '--profile', profile, 'add', ...links.map(plugin => `link:${plugin.link}`)], {
  encoding: 'utf8', stdio: 'inherit', maxBuffer: 64 * 1024 * 1024,
});

const profileDir = join(home, '.dsh', 'profiles', profile);
const profilePkgPath = join(profileDir, 'package.json');
let profileSource;
try {
  profileSource = readFileSync(profilePkgPath, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') fail(`нет профиля ${profile}: ${profilePkgPath}`);
  throw error;
}
const profileMode = statSync(profilePkgPath).mode & 0o777;
const profilePkg = JSON.parse(profileSource);
profilePkg.dsh ??= {};
profilePkg.dsh.profile ??= {};
profilePkg.dsh.profile.bundles ??= [];
const bundles = profilePkg.dsh.profile.bundles;
const missing = links.map(plugin => plugin.name).filter(name => !bundles.includes(name));
let backup = null;
if (missing.length > 0) {
  backup = `${profilePkgPath}.before-dsh-tools`;
  // Резервная копия — точные исходные байты профиля, снятые до правки;
  // существующий бэкап заменяется атомарно, как и сам профиль.
  atomicWrite(backup, profileSource, profileMode);
  bundles.push(...missing);
  atomicWrite(profilePkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`, profileMode);
  log(`bundle добавлены: ${missing.join(', ')} (резервная копия ${backup})`);
} else {
  log('все плагины уже включены в bundles');
}

log('проверяю собранный профиль (dsh --dump-config)…');
try {
  const dump = execFileSync(dshBin, ['--profile', profile, '--dump-config'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  });
  const absent = links.map(plugin => plugin.name).filter(name => !dump.includes(name));
  if (absent.length > 0) throw new Error(`в dump-config нет: ${absent.join(', ')}`);
  log('профиль видит все плагины.');
} catch (error) {
  if (backup !== null) {
    atomicWrite(profilePkgPath, readFileSync(backup, 'utf8'), profileMode);
    log(`проверка не прошла, bundle откатаны: ${error.message}`);
  }
  fail('установка не завершена.');
}

log('готово. Перезапустите `dsh web` — в новой сессии появятся инструменты:');
log('  android_install, android_set (остальное — @zseven-w/dsh-android)');
log('  github_release, github_release_upload (остальное — @perrylink/dsh-github)');
log('  anooplan_apk_check, anooplan_visual_check');
