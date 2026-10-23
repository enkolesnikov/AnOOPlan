import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('release: backup выключен, WebView debugging только в debug-сборке', () => {
  const manifest = read('android/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:debuggable="false"/);
  const activity = read('android/java/com/anooplan/app/MainActivity.java');
  assert.match(activity, /ApplicationInfo\.FLAG_DEBUGGABLE/);
  assert.match(activity, /setWebContentsDebuggingEnabled\(debuggable\)/);
  assert.doesNotMatch(activity, /setWebContentsDebuggingEnabled\(true\)/);
});

test('build-apk: без ключа не генерирует его случайно, есть unsigned-режим для CI', () => {
  const script = read('scripts/build-apk.sh');
  assert.match(script, /ALLOW_NEW_KEYSTORE/);
  assert.match(script, /UNSIGNED_APK/);
  assert.match(script, /AnOOPlan-\$\{VERSION_NAME\}-unsigned\.apk/);
  assert.match(script, /в CI ключ должен приходить из секрета/);
  assert.match(script, /KS_PASS_FILE/);
  assert.doesNotMatch(script, /anooplan-build-pass/);
});

test('обычный CI собирает неподписанный APK и не трогает keystore', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  assert.match(workflow, /UNSIGNED_APK: '1'/);
  assert.match(workflow, /AnOOPlan-apk-unsigned/);
  assert.doesNotMatch(workflow, /keytool -genkeypair/);
  assert.doesNotMatch(workflow, /ANDROID_KEYSTORE_BASE64/);
});

test('release-workflow подписывает из секретов и публикует GitHub Release', () => {
  const workflow = read('.github/workflows/android-release.yml');
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /secrets\.ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /secrets\.ANDROID_KS_PASS/);
  assert.match(workflow, /secrets\.ANDROID_CERT_SHA256/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /git ls-remote --tags origin/, 'описание релиза ищется в объекте тега');
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/git\/tags\//, 'описание берётся из API тега');
  assert.match(workflow, /git tag -l --format='%\(contents\)'/, 'есть fallback на локальную аннотацию тега');
  assert.match(workflow, /--notes "\$NOTES"/, 'описание релиза передаётся в gh release');
  assert.match(workflow, /rm -rf keystore/);
  assert.doesNotMatch(workflow, /keytool -genkeypair/);
});
