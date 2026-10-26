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
 * Использование: node dsh/install.mjs [--profile web] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  readlinkSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

if (!existsSync(join(repoRoot, 'package.json'))) {
  fail(`${repoRoot} не похож на корень репозитория AnOOPlan`);
}
if (!existsSync(pluginRoot)) fail(`нет каталога плагинов: ${pluginRoot}`);

const plugins = readdirSync(pluginRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(pluginRoot, entry.name, 'package.json')))
  .map(entry => {
    const dir = join(pluginRoot, entry.name);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { dir, name: pkg.name, description: pkg.description ?? '' };
  });
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
  let isSymlink = false;
  try {
    isSymlink = lstatSync(plugin.link).isSymbolicLink();
  } catch {
    // ссылки ещё нет — создадим ниже
  }
  if (isSymlink) {
    const target = resolve(localPlugins, readlinkSync(plugin.link));
    if (target !== plugin.dir) fail(`${plugin.link} уже ведёт в ${target}; уберите его вручную`);
    log(`симлинк уже на месте: ${plugin.name}`);
  } else if (existsSync(plugin.link)) {
    fail(`${plugin.link} существует и это не симлинк — не трогаю`);
  } else {
    symlinkSync(plugin.dir, plugin.link, 'dir');
    log(`симлинк создан: ${plugin.name}`);
  }
}

log(`добавляю link-зависимости в профиль ${profile}…`);
execFileSync(dshBin, ['plugin', '--profile', profile, 'add', ...links.map(plugin => `link:${plugin.link}`)], {
  encoding: 'utf8', stdio: 'inherit', maxBuffer: 64 * 1024 * 1024,
});

const profileDir = join(home, '.dsh', 'profiles', profile);
const profilePkgPath = join(profileDir, 'package.json');
if (!existsSync(profilePkgPath)) fail(`нет профиля ${profile}: ${profilePkgPath}`);
const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'));
profilePkg.dsh ??= {};
profilePkg.dsh.profile ??= {};
profilePkg.dsh.profile.bundles ??= [];
const bundles = profilePkg.dsh.profile.bundles;
const missing = links.map(plugin => plugin.name).filter(name => !bundles.includes(name));
let backup = null;
if (missing.length > 0) {
  backup = `${profilePkgPath}.before-dsh-tools`;
  copyFileSync(profilePkgPath, backup);
  bundles.push(...missing);
  writeFileSync(profilePkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`);
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
    copyFileSync(backup, profilePkgPath);
    log(`проверка не прошла, bundle откатаны: ${error.message}`);
  }
  fail('установка не завершена.');
}

log('готово. Перезапустите `dsh web` — в новой сессии появятся инструменты:');
log('  android_devices, android_boot, android_install, android_screenshot, android_set, android_logcat');
log('  github_release, github_release_upload, github_workflow_runs, github_issues');
log('  anooplan_apk_check, anooplan_android_check, anooplan_visual_check, anooplan_release_status');
