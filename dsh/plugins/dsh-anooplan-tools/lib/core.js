/**
 * Ядро инструментов AnOOPlan для DSH. Без внешних зависимостей: только Node
 * builtins, чтобы локальный плагин грузился без установки пакетов в профиль.
 *
 * Все команды запускаются через execFile/spawn с массивом аргументов (без shell),
 * поэтому пользовательский ввод не может подставить команду. Пути к APK и
 * скриншотам ограничены каталогом репозитория.
 *
 * @module dsh-anooplan-tools/core
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_CERT_SHA256 = '6431374cf6a7d385c4c47f0f2bf54fcb5ee5b2c7120f057b18c4062af92fe097';
const PKG_NAME = 'com.anooplan.app';
const APK_PATTERN = /^AnOOPlan-\d+\.\d+\.\d+\.apk$/;

function run(file, args, { cwd, timeout = 60_000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd, timeout, maxBuffer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message ?? error),
    };
  }
}

function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function resolveInside(root, path) {
  const target = isAbsolute(path) ? path : resolve(root, path);
  return inside(root, target) ? target : null;
}

function toolPath(root, config, tool) {
  const dir = config.buildToolsDir || 'tools/build-tools/35.0.0';
  const candidate = isAbsolute(dir) ? resolve(dir, tool) : resolve(root, dir, tool);
  return existsSync(candidate) ? candidate : tool;
}

function adbPath(config) {
  const candidate = config.adbPath || '/root/android-sdk/platform-tools/adb';
  return existsSync(candidate) ? candidate : 'adb';
}

export function newestApk(root) {
  const dir = resolve(root, 'build');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter(name => APK_PATTERN.test(name))
    .map(name => ({ name, path: resolve(dir, name), mtime: statSync(resolve(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path ?? null;
}

function apkFile(root, config, requested) {
  if (requested) {
    const target = resolveInside(root, requested);
    if (!target) return { error: `APK вне каталога репозитория: ${requested}` };
    if (!existsSync(target)) return { error: `APK не найден: ${requested}` };
    return { path: target };
  }
  const latest = newestApk(root);
  if (!latest) return { error: 'В build/ нет подписанного APK (AnOOPlan-X.Y.Z.apk)' };
  return { path: latest };
}

function permissionsOf(text) {
  const list = [];
  for (const line of text.split('\n')) {
    const match = /uses-permission: name='([^']+)'/.exec(line);
    if (match) list.push(match[1]);
  }
  return list;
}

/** Статическая проверка подписанного APK: версия, разрешения, сертификат, вес. */
export function apkCheck(config, requestedApk) {
  const root = config.root;
  const planned = apkFile(root, config, requestedApk);
  if (planned.error) return { ok: false, apk: null, problems: [planned.error] };

  const apk = planned.path;
  const problems = [];
  const sizeBytes = statSync(apk).size;
  const maxApkBytes = config.maxApkBytes ?? 1_600_000;

  let versionName = null;
  let versionCode = null;
  let permissions = [];
  let certificateSha256 = null;

  const aapt = toolPath(root, config, 'aapt');
  const apksigner = toolPath(root, config, 'apksigner');

  const badging = run(aapt, ['dump', 'badging', apk]);
  if (badging.ok) {
    const line = badging.stdout.split('\n')[0] ?? '';
    versionName = /versionName='([^']*)'/.exec(line)?.[1] ?? null;
    versionCode = /versionCode='([^']*)'/.exec(line)?.[1] ?? null;
  } else {
    problems.push(`aapt dump badging: ${badging.stderr.trim() || 'ошибка'}`);
  }

  const permissionsDump = run(aapt, ['dump', 'permissions', apk]);
  if (permissionsDump.ok) permissions = permissionsOf(permissionsDump.stdout);
  else problems.push(`aapt dump permissions: ${permissionsDump.stderr.trim() || 'ошибка'}`);

  const certs = run(apksigner, ['verify', '--print-certs', apk]);
  if (certs.ok) {
    certificateSha256 = /SHA-256 digest:\s*([0-9a-f]{64})/i.exec(certs.stdout)?.[1]?.toLowerCase() ?? null;
  } else {
    problems.push(`apksigner verify: ${certs.stderr.trim() || 'ошибка'}`);
  }

  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  } catch (error) {
    problems.push(`package.json: ${error.message}`);
  }
  let manifest = '';
  try {
    manifest = readFileSync(resolve(root, 'android/AndroidManifest.xml'), 'utf8');
  } catch (error) {
    problems.push(`AndroidManifest.xml: ${error.message}`);
  }
  const manifestName = /android:versionName="([^"]+)"/.exec(manifest)?.[1] ?? null;
  const manifestCode = /android:versionCode="(\d+)"/.exec(manifest)?.[1] ?? null;

  const expectedCert = (config.expectedCertSha256 || DEFAULT_CERT_SHA256).toLowerCase();
  const hasInternet = permissions.includes('android.permission.INTERNET');
  const checks = {
    versionMatchesPackage: pkg !== null && versionName !== null && versionName === pkg.version,
    versionCodeMatchesPackage: pkg !== null && versionCode !== null && versionCode === String(pkg.androidVersionCode),
    manifestMatchesPackage: pkg !== null && manifestName === pkg.version && manifestCode === String(pkg.androidVersionCode),
    noInternetPermission: !hasInternet,
    certificateMatches: certificateSha256 !== null && certificateSha256 === expectedCert,
    sizeWithinBudget: sizeBytes <= maxApkBytes,
  };

  if (!checks.versionMatchesPackage) problems.push(`versionName ${versionName} ≠ package.json ${pkg?.version}`);
  if (!checks.versionCodeMatchesPackage) problems.push(`versionCode ${versionCode} ≠ package.json ${pkg?.androidVersionCode}`);
  if (!checks.manifestMatchesPackage) problems.push('манифест расходится с package.json');
  if (!checks.noInternetPermission) problems.push('в APK есть разрешение INTERNET');
  if (!checks.certificateMatches) problems.push('сертификат не совпадает с ожидаемым SHA-256');
  if (!checks.sizeWithinBudget) problems.push(`APK ${sizeBytes} Б больше бюджета ${maxApkBytes} Б`);

  return {
    ok: problems.length === 0,
    apk: relative(root, apk),
    sizeBytes,
    sizeMB: Number((sizeBytes / 1024 / 1024).toFixed(2)),
    versionName,
    versionCode,
    packageName: PKG_NAME,
    permissions,
    hasInternet,
    certificateSha256,
    expectedCertificateSha256: expectedCert,
    checks,
    problems,
  };
}

function sleep(ms) {
  return new Promise(done => setTimeout(done, ms));
}

/**
 * Ждёт, пока WebView приложения действительно отрисует интерфейс: холодный
 * старт занимает 10–15 с, фиксированная пауза даёт пустой скриншот.
 *
 * Если поверх приложения висит системный ANR-диалог эмулятора («System UI isn't
 * responding»), нажимаем «Wait» по bounds из accessibility-дерева и продолжаем.
 */
async function waitForAppUi(adb, serial, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const focus = run(adb, ['-s', serial, 'shell', 'dumpsys', 'window', 'windows']);
    if (focus.ok && focus.stdout.includes(PKG_NAME)) {
      const dump = run(adb, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/anooplan-check.xml'], { timeout: 15_000 });
      if (dump.ok) {
        const xml = run(adb, ['-s', serial, 'shell', 'cat', '/sdcard/anooplan-check.xml']).stdout ?? '';
        if (/isn.t responding|не отвечает/i.test(xml)) {
          const waitButton = /text="(?:Wait|Подождать|Ждать)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
          if (waitButton !== null) {
            const x = Math.round((Number(waitButton[1]) + Number(waitButton[3])) / 2);
            const y = Math.round((Number(waitButton[2]) + Number(waitButton[4])) / 2);
            run(adb, ['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);
            await sleep(2_000);
            continue;
          }
          return { ready: false, systemDialog: true };
        }
        if (/(Новый проект|Учебный проект|План)/.test(xml)) {
          await sleep(500);
          return { ready: true, systemDialog: false };
        }
      }
    }
    await sleep(2_000);
  }
  return { ready: false, systemDialog: false };
}

function connectedDevices(adb) {
  const result = run(adb, ['devices']);
  if (!result.ok) return { devices: [], error: result.stderr.trim() || 'adb devices недоступен' };
  const devices = [];
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\t(\S+)$/.exec(line.trim());
    if (match && match[2] === 'device') devices.push(match[1]);
  }
  return { devices, error: null };
}

function dumpsysVersion(adb, serial) {
  const result = run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', PKG_NAME]);
  if (!result.ok) return { versionName: null, versionCode: null };
  return {
    versionName: /versionName=(\S+)/.exec(result.stdout)?.[1] ?? null,
    versionCode: /versionCode=(\d+)/.exec(result.stdout)?.[1] ?? null,
  };
}

/**
 * Установка последнего APK на подключённый эмулятор/устройство + опциональная
 * смена тёмной темы/масштаба шрифта и скриншот в build/.
 */
export async function androidCheck(config, options = {}) {
  const root = config.root;
  const adb = adbPath(config);
  const { devices, error } = connectedDevices(adb);
  if (error) return { ok: false, problems: [error] };
  if (devices.length === 0) {
    return { ok: false, problems: ['Нет подключённого устройства: adb devices пуст. Запустите эмулятор.'] };
  }
  const serial = options.serial || devices[0];
  const problems = [];
  const planned = apkFile(root, config, options.apk);
  if (planned.error) return { ok: false, problems: [planned.error] };

  let installed = false;
  if (options.install !== false) {
    const install = run(adb, ['-s', serial, 'install', '-r', planned.path], { timeout: 180_000 });
    installed = install.ok;
    if (!install.ok) problems.push(`adb install: ${install.stderr.trim() || install.stdout.trim()}`);
  }

  const theme = typeof options.dark === 'boolean' ? (options.dark ? 'dark' : 'light') : null;
  if (theme) {
    const result = run(adb, ['-s', serial, 'shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no']);
    if (!result.ok) problems.push(`uimode: ${result.stderr.trim()}`);
  }

  const fontScale = typeof options.fontScale === 'number' ? options.fontScale : null;
  if (fontScale !== null) {
    if (fontScale < 0.85 || fontScale > 1.6) problems.push('fontScale вне диапазона 0.85–1.6');
    else {
      const result = run(adb, ['-s', serial, 'shell', 'settings', 'put', 'system', 'font_scale', String(fontScale)]);
      if (!result.ok) problems.push(`font_scale: ${result.stderr.trim()}`);
    }
  }

  const stop = run(adb, ['-s', serial, 'shell', 'am', 'force-stop', PKG_NAME]);
  if (!stop.ok) problems.push(`force-stop: ${stop.stderr.trim()}`);
  const start = run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', `${PKG_NAME}/.MainActivity`]);
  if (!start.ok) problems.push(`am start: ${start.stderr.trim()}`);

  const ui = await waitForAppUi(adb, serial, options.waitMs ?? 40_000);
  if (!ui.ready) problems.push('интерфейс не подтвердил загрузку за отведённое время');
  if (ui.systemDialog) problems.push('на экране остался системный диалог эмулятора');
  const uiReady = ui.ready;
  const version = dumpsysVersion(adb, serial);

  let screenshot = null;
  if (options.screenshot !== false) {
    const shot = spawnSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    if (shot.status === 0 && shot.stdout?.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshot = resolve(root, 'build', `device-check-${stamp}.png`);
      writeFileSync(screenshot, shot.stdout);
    } else {
      problems.push(`screencap: ${String(shot.stderr ?? 'ошибка')}`);
    }
  }

  return {
    ok: problems.length === 0,
    serial,
    apk: relative(root, planned.path),
    installed,
    theme,
    fontScale,
    uiReady,
    versionName: version.versionName,
    versionCode: version.versionCode,
    screenshot: screenshot ? relative(root, screenshot) : null,
    problems,
  };
}

/** Прогон визуальных эталонов (npm run test:visual) с хвостом вывода. */
export function visualCheck(config, options = {}) {
  const root = config.root;
  const script = options.update ? 'test:visual:update' : 'test:visual';
  const started = Date.now();
  const result = run('npm', ['run', script], {
    cwd: root,
    timeout: options.timeout ?? 900_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const tail = output.split('\n').slice(-30).join('\n');
  return {
    ok: result.ok,
    script,
    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    tail,
    problems: result.ok ? [] : [`npm run ${script} завершился с ошибкой`],
  };
}

/** Статус GitHub Release: тег, активы, размеры. Токен — из окружения. */
export async function releaseStatus(config, options = {}) {
  const tag = options.tag || 'latest';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const url = tag === 'latest'
    ? `https://api.github.com/repos/${config.repoSlug}/releases/latest`
    : `https://api.github.com/repos/${config.repoSlug}/releases/tags/${encodeURIComponent(tag)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-anooplan-tools',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      return { ok: false, problems: [`GitHub API ${response.status} для ${tag}`], tag };
    }
    const release = await response.json();
    return {
      ok: true,
      tag: release.tag_name,
      name: release.name,
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      url: release.html_url,
      bodyLines: String(release.body ?? '').split('\n').length,
      assets: (release.assets ?? []).map(asset => ({ name: asset.name, size: asset.size })),
      problems: [],
    };
  } catch (error) {
    return { ok: false, problems: [`GitHub API: ${error.message}`], tag };
  }
}
