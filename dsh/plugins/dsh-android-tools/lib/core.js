/**
 * Дополнение к @zseven-w/dsh-android: то, чего нет в маркет-плагине.
 *   android_install — установка произвольного APK (маркет умеет только build+install из Gradle);
 *   android_set     — системная тёмная тема и font_scale для проверки доступности.
 *
 * Без внешних зависимостей и shell: только execFile с массивом аргументов.
 *
 * @module dsh-android-tools/core
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function run(file, args, { timeout = 120_000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  try {
    const stdout = execFileSync(file, args, { timeout, maxBuffer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    return { ok: false, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message ?? error) };
  }
}

function adbOf(config) {
  const candidate = config.adbPath || '/root/android-sdk/platform-tools/adb';
  return existsSync(candidate) ? candidate : 'adb';
}

function firstDevice(config) {
  const adb = adbOf(config);
  const result = run(adb, ['devices', '-l']);
  if (!result.ok) return { device: null, problems: [result.stderr.trim() || 'adb недоступен'] };
  const device = result.stdout.split('\n')
    .map(line => /^(\S+)\s+(\S+)/.exec(line.trim()))
    .find(match => match?.[2] === 'device')?.[1] ?? null;
  return { device, problems: device ? [] : ['нет подключённого устройства'] };
}

function resolveApk(config, apk) {
  const base = config.root || process.cwd();
  const target = resolve(base, apk);
  if (!existsSync(target)) return { error: `APK не найден: ${apk}` };
  return { path: target, sizeBytes: statSync(target).size };
}

/** Устанавливает произвольный APK и, если задан launch, запускает activity. */
export function androidInstall(config, options = {}) {
  const adb = adbOf(config);
  if (!options.apk) return { ok: false, problems: ['нужен apk: путь к файлу'] };
  const target = resolveApk(config, options.apk);
  if (target.error) return { ok: false, problems: [target.error] };
  const current = firstDevice(config);
  const serial = options.serial || current.device;
  if (!serial) return { ok: false, problems: current.problems };

  const install = run(adb, ['-s', serial, 'install', '-r', target.path], { timeout: 180_000 });
  const result = {
    ok: install.ok,
    serial,
    apk: target.path,
    installed: install.ok,
    launched: false,
    versionName: null,
    versionCode: null,
    problems: install.ok ? [] : [`adb install: ${install.stderr.trim() || install.stdout.trim()}`],
  };
  if (install.ok && options.launch) {
    const start = run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', options.launch]);
    result.launched = start.ok;
    if (!start.ok) result.problems.push(`am start: ${start.stderr.trim()}`);
    const pkg = options.launch.split('/')[0];
    const dumpsys = run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', pkg]);
    result.versionName = /versionName=(\S+)/.exec(dumpsys.stdout)?.[1] ?? null;
    result.versionCode = /versionCode=(\d+)/.exec(dumpsys.stdout)?.[1] ?? null;
  }
  return result;
}

/** Системная тёмная тема и/или масштаб шрифта — для проверки доступности APK. */
export function androidSet(config, options = {}) {
  const adb = adbOf(config);
  const current = firstDevice(config);
  const serial = options.serial || current.device;
  if (!serial) return { ok: false, problems: current.problems };
  const problems = [];
  const applied = [];
  if (typeof options.dark === 'boolean') {
    const value = options.dark ? 'yes' : 'no';
    const result = run(adb, ['-s', serial, 'shell', 'cmd', 'uimode', 'night', value]);
    if (!result.ok) problems.push(`uimode: ${result.stderr.trim()}`);
    else applied.push(`night=${value}`);
  }
  if (typeof options.fontScale === 'number') {
    if (options.fontScale < 0.85 || options.fontScale > 1.6) problems.push('fontScale вне диапазона 0.85–1.6');
    else {
      const result = run(adb, ['-s', serial, 'shell', 'settings', 'put', 'system', 'font_scale', String(options.fontScale)]);
      if (!result.ok) problems.push(`font_scale: ${result.stderr.trim()}`);
      else applied.push(`font_scale=${options.fontScale}`);
    }
  }
  if (applied.length === 0 && problems.length === 0) problems.push('не задано ни dark, ни fontScale');
  return { ok: problems.length === 0, serial, applied, problems };
}
