import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('манифест: minSdk 24, targetSdk 35, версия совпадает с package.json', () => {
  const manifest = read('android/AndroidManifest.xml');
  assert.match(manifest, /android:minSdkVersion="24"/);
  assert.match(manifest, /android:targetSdkVersion="35"/);
  const name = /android:versionName="([^"]+)"/.exec(manifest)?.[1];
  const code = /android:versionCode="(\d+)"/.exec(manifest)?.[1];
  assert.equal(name, JSON.parse(read('package.json')).version);
  assert.ok(code && Number(code) >= 8);
});

test('сборка APK использует targetSdk 35 и официальные build-tools 35', () => {
  const script = read('scripts/build-apk.sh');
  assert.match(script, /TARGET_SDK="\$\{TARGET_SDK:-35\}"/);
  assert.match(script, /build-tools\/35\.0\.0/);
  assert.match(script, /--target-sdk-version "\$TARGET_SDK"/);
  assert.match(script, /VERSION_NAME="\$\{VERSION_NAME:-1\.7\.1\}"/);
});

test('fetch-tools скачивает platform 35 и build-tools 35', () => {
  const script = read('scripts/fetch-tools.sh');
  assert.match(script, /SDK_PLATFORM:-35/);
  assert.match(script, /BUILD_TOOLS_VERSION:-35\.0\.0/);
  assert.match(script, /platform-\$\{PLATFORM\}_r02\.zip/);
  assert.match(script, /build-tools_r\$\{BT_MAJOR\}_linux\.zip/);
});

test('Android 15 edge-to-edge: MainActivity учитывает системные insets', () => {
  const activity = read('android/java/com/anooplan/app/MainActivity.java');
  assert.match(activity, /Build\.VERSION\.SDK_INT >= 35/);
  assert.match(activity, /setDecorFitsSystemWindows\(false\)/);
  assert.match(activity, /OnApplyWindowInsetsListener/);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\)/);
  assert.match(activity, /WindowInsets\.Type\.ime\(\)/);
  assert.match(activity, /setPadding\(/);
});
