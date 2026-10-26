/**
 * Android/ADB-обёртка для DSH: устройства, запуск эмулятора, установка,
 * скриншот, тема/шрифт, logcat. Без внешних зависимостей и без shell:
 * только execFile/spawn с массивом аргументов.
 *
 * @module dsh-android-tools/core
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

export function devices(config) {
  const adb = adbOf(config);
  const result = run(adb, ['devices', '-l']);
  if (!result.ok) return { ok: false, devices: [], problems: [result.stderr.trim() || 'adb недоступен'] };
  const list = [];
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)(.*)$/.exec(line.trim());
    if (match && !match[1].startsWith('List')) {
      list.push({ serial: match[1], state: match[2], details: match[3].trim() });
    }
  }
  return { ok: true, devices: list, problems: [] };
}

function wait(ms) {
  return new Promise(done => setTimeout(done, ms));
}

function firstDevice(config) {
  const result = devices(config);
  const device = result.devices.find(item => item.state === 'device');
  return { device: device?.serial ?? null, list: result.devices, problems: result.problems };
}

function resolveApk(config, apk) {
  const base = config.root || process.cwd();
  const target = resolve(base, apk);
  if (!existsSync(target)) return { error: `APK не найден: ${apk}` };
  return { path: target, sizeBytes: statSync(target).size };
}

/** Список подключённых устройств/эмуляторов. */
export function androidDevices(config) {
  const result = devices(config);
  return { ...result, adb: adbOf(config) };
}

/**
 * Запускает headless-эмулятор, если устройства нет, и ждёт загрузки.
 * Возвращает serial и признак, был ли эмулятор уже запущен.
 */
export async function androidBoot(config, options = {}) {
  const existing = firstDevice(config);
  if (existing.device) {
    return { ok: true, alreadyRunning: true, serial: existing.device, devices: existing.list, problems: [] };
  }
  const emulator = config.emulatorPath || '/root/android-sdk/emulator/emulator';
  const avd = options.avd || config.defaultAvd || 'AnOOPlan25';
  const avdHome = config.avdHome || '/root/Anooplan/build/avd-home';
  if (!existsSync(emulator)) return { ok: false, problems: [`эмулятор не найден: ${emulator}`] };
  if (!existsSync(join(avdHome, `${avd}.avd`))) {
    return { ok: false, problems: [`AVD ${avd} не найден в ${avdHome}`] };
  }
  const emulatorHome = config.emulatorHome || '/root/Anooplan/build/android-home';
  const child = spawn(emulator, ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot',
    '-gpu', 'swiftshader_indirect', '-accel', 'on'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ANDROID_AVD_HOME: avdHome, ANDROID_EMULATOR_HOME: emulatorHome, ANDROID_USER_HOME: emulatorHome },
  });
  child.unref();

  const timeoutMs = options.timeoutMs ?? 180_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await wait(3_000);
    const current = firstDevice(config);
    if (current.device) {
      const booted = run(adbOf(config), ['-s', current.device, 'shell', 'getprop', 'sys.boot_completed']);
      if (booted.ok && booted.stdout.trim() === '1') {
        return { ok: true, alreadyRunning: false, serial: current.device, avd, problems: [] };
      }
    }
  }
  return { ok: false, avd, problems: [`эмулятор не загрузился за ${Math.round(timeoutMs / 1000)} с`] };
}

/** Устанавливает APK и, если задан launch, запускает приложение. */
export function androidInstall(config, options = {}) {
  const adb = adbOf(config);
  const target = options.apk ? resolveApk(config, options.apk) : null;
  if (!options.apk) return { ok: false, problems: ['нужен apk: путь к файлу'] };
  if (target.error) return { ok: false, problems: [target.error] };
  const { device, problems } = firstDevice(config);
  const serial = options.serial || device;
  if (!serial) return { ok: false, problems: [...problems, 'нет подключённого устройства'] };

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

/** Скриншот текущего экрана в файл (по умолчанию build/screenshot-<ts>.png). */
export function androidScreenshot(config, options = {}) {
  const adb = adbOf(config);
  const { device, problems } = firstDevice(config);
  const serial = options.serial || device;
  if (!serial) return { ok: false, problems: [...problems, 'нет подключённого устройства'] };
  const base = config.root || process.cwd();
  const dir = options.dir || config.screenshotDir || join(base, 'build');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = options.path ? resolve(base, options.path) : join(dir, `screenshot-${stamp}.png`);
  mkdirSync(dirname(target), { recursive: true });
  const shot = spawnSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  if (shot.status !== 0 || !shot.stdout?.length) {
    return { ok: false, serial, problems: [`screencap: ${String(shot.stderr ?? 'ошибка')}`] };
  }
  writeFileSync(target, shot.stdout);
  return {
    ok: true,
    serial,
    path: target,
    sizeBytes: statSync(target).size,
    problems: [],
  };
}

/** Тёмная тема и/или масштаб системного шрифта. */
export function androidSet(config, options = {}) {
  const adb = adbOf(config);
  const { device, problems } = firstDevice(config);
  const serial = options.serial || device;
  if (!serial) return { ok: false, problems: [...problems, 'нет подключённого устройства'] };
  const applied = [];
  if (typeof options.dark === 'boolean') {
    const value = options.dark ? 'yes' : 'no';
    const result = run(adb, ['-s', serial, 'shell', 'cmd', 'uimode', 'night', value]);
    if (!result.ok) problems.push(`uimode: ${result.stderr.trim()}`);
    else applied.push(`night=${value}`);
  }
  if (typeof options.fontScale === 'number') {
    if (options.fontScale < 0.85 || options.fontScale > 1.6) {
      problems.push('fontScale вне диапазона 0.85–1.6');
    } else {
      const result = run(adb, ['-s', serial, 'shell', 'settings', 'put', 'system', 'font_scale', String(options.fontScale)]);
      if (!result.ok) problems.push(`font_scale: ${result.stderr.trim()}`);
      else applied.push(`font_scale=${options.fontScale}`);
    }
  }
  if (applied.length === 0 && problems.length === 0) problems.push('не задано ни dark, ни fontScale');
  return { ok: problems.length === 0, serial, applied, problems };
}

/** Последние строки logcat, при необходимости отфильтрованные подстрокой. */
export function androidLogcat(config, options = {}) {
  const adb = adbOf(config);
  const { device, problems } = firstDevice(config);
  const serial = options.serial || device;
  if (!serial) return { ok: false, problems: [...problems, 'нет подключённого устройства'] };
  const limit = Math.min(Math.max(Number(options.lines) || 200, 1), 2_000);
  const result = run(adb, ['-s', serial, 'logcat', '-d', '-t', String(limit)]);
  if (!result.ok) return { ok: false, serial, problems: [result.stderr.trim() || 'logcat недоступен'] };
  let lines = result.stdout.split('\n').filter(Boolean);
  if (options.filter) {
    const needle = String(options.filter);
    lines = lines.filter(line => line.includes(needle));
  }
  lines = lines.slice(-limit);
  return { ok: true, serial, lines: lines.length, text: lines.join('\n'), problems: [] };
}
