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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
