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
/** YAML без комментариев: закомментированный шаг не должен считаться гейтом. */
const liveYaml = (text: string): string => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

test('release workflow проверяет версию, разрешения, размер и непустой сертификат', () => {
  const workflow = liveYaml(read('.github/workflows/android-release.yml'));
  assert.match(workflow, /^\s*npm run build\s*$/m, 'свежий dist перед бюджетом размера');
  assert.match(workflow, /^\s*npm run size\s*$/m, 'бюджет JS/CSS в release-гейте');
  assert.match(workflow, /\[ "\$GITHUB_REF_NAME" = "v\$VERSION_NAME" \]/, 'тег сверяется с package.json');
  assert.match(workflow, /android\.permission\.VIBRATE/, 'разрешения — точный allowlist');
  assert.match(workflow, /APK="build\/AnOOPlan-\$VERSION_NAME\.apk"/, 'точный путь APK, а не ls|head');
  assert.match(workflow, /dump badging/, 'versionName/versionCode из APK');
  assert.match(workflow, /versionName='\$VERSION_NAME'/, 'сверка versionName с package.json');
  assert.match(workflow, /versionCode='\$VERSION_CODE'/, 'сверка versionCode с package.json');
  assert.match(workflow, /dump permissions/, 'разрешения APK');
  assert.match(workflow, /grep -q 'android\.permission\.INTERNET'/, 'отказ при INTERNET');
  assert.match(squash(workflow), /\[ "\$SIZE" -le 4194304 \]/, 'бюджет APK ≤4 МБ (строго ≤)');
  assert.match(workflow, /sha256sum "\$APK"/, 'SHA-256 опубликованного APK');
  assert.match(workflow, /\$APK\.sha256/, 'файл SHA-256 прикладывается к релизу');
  assert.match(workflow, /ANDROID_CERT_SHA256/, 'сертификат из секрета');
  // Пустой секрет — ошибка, а не тихий пропуск проверки.
  assert.match(squash(workflow), /\[ -n "\$EXPECTED_CERT" \] \|\| \{/);
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
  // Сравнение подстрок вместо регэкспа: версия из package.json не требует экранирования,
  // а сборка шаблона из данных — ровно то, на что указывал CodeQL (js/incomplete-sanitization).
  assert.ok(manifest.includes(`android:versionName="${pkg.version}"`), 'versionName совпадает с package.json');
  assert.ok(manifest.includes(`android:versionCode="${pkg.androidVersionCode}"`), 'versionCode совпадает с package.json');
});
