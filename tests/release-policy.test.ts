import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Статические проверки release-гейта: версия/разрешения/размер APK,
 * закрепление инструментов по SHA и отсутствие пароля keystore в argv.
 * Живая сборка APK проверяется отдельно (scripts/build-apk.sh), здесь —
 * контракт CI, который легко потерять при правке workflow.
 */

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const squash = (text: string): string => text.replace(/\s+/g, ' ');

test('release workflow проверяет версию, разрешения, размер и непустой сертификат', () => {
  const workflow = read('.github/workflows/android-release.yml');
  assert.match(workflow, /npm run build\b/, 'свежий dist перед бюджетом размера');
  assert.match(workflow, /npm run size\b/, 'бюджет JS/CSS в release-гейте');
  assert.match(workflow, /dump badging/, 'versionName/versionCode из APK');
  assert.match(workflow, /versionName/, 'сверка versionName с package.json');
  assert.match(workflow, /versionCode/, 'сверка versionCode с package.json');
  assert.match(workflow, /dump permissions/, 'разрешения APK');
  assert.match(workflow, /INTERNET/, 'отказ при INTERNET');
  assert.match(workflow, /4194304/, 'бюджет APK ≤4 МБ');
  assert.match(workflow, /sha256sum/, 'SHA-256 опубликованного APK');
  assert.match(workflow, /ANDROID_CERT_SHA256/, 'сертификат из секрета');
  // Пустой секрет — ошибка, а не тихий пропуск проверки.
  assert.match(squash(workflow), /\[ -n "\$EXPECTED_CERT" \] \|\|/);
});

test('release-гейт закрепляет инструменты Android по SHA', () => {
  const verify = read('scripts/verify-tools.sh');
  for (const constant of ['SHA_ANDROID_JAR', 'SHA_AAPT', 'SHA_APKSIGNER', 'SHA_ZIPALIGN', 'SHA_D8']) {
    assert.match(verify, new RegExp(`^${constant}="[0-9a-f]{64}"$`, 'm'), `${constant} закреплён`);
  }
  assert.match(verify, /sha256sum/);
  assert.match(read('.github/workflows/android-release.yml'), /bash scripts\/verify-tools\.sh/);
  assert.match(read('.github/workflows/android-apk.yml'), /bash scripts\/verify-tools\.sh/);
  // Переопределение версии/URL не должно молча обходить проверку.
  const fetch = read('scripts/fetch-tools.sh');
  assert.match(fetch, /VERIFY_TOOLS_ALLOW_CUSTOM/);
  assert.match(fetch, /Нестандартные инструменты без VERIFY_TOOLS_ALLOW_CUSTOM=1 запрещены/);
});

test('пароль keystore не передаётся аргументом командной строки', () => {
  const build = read('scripts/build-apk.sh');
  assert.doesNotMatch(build, /pass:\$KS_PASS/, 'пароль не должен быть в argv apksigner');
  assert.match(build, /--ks-pass env:KS_PASS/);
  assert.match(build, /--key-pass env:KS_PASS/);
  assert.match(build, /-storepass:env KS_PASS/);
});

test('офлайн-контракт манифеста и версия из package.json', () => {
  const manifest = read('android/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:debuggable="false"/);
  const pkg = JSON.parse(read('package.json')) as { version: string; androidVersionCode: number };
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(pkg.androidVersionCode) && pkg.androidVersionCode > 0);
  assert.match(manifest, new RegExp(`android:versionName="${pkg.version.replace(/\./g, '\\.')}"`));
  assert.match(manifest, new RegExp(`android:versionCode="${pkg.androidVersionCode}"`));
});
