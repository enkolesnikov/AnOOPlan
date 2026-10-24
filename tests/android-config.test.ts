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
  // Версия и versionCode — из package.json (единый источник), манифест проверяется в первом тесте.
  const pkg = JSON.parse(read('package.json'));
  const manifest = read('android/AndroidManifest.xml');
  const manifestCode = Number(/android:versionCode="(\d+)"/.exec(manifest)?.[1]);
  const manifestName = /android:versionName="([^"]+)"/.exec(manifest)?.[1];
  assert.ok(script.includes("require('${ROOT}/package.json').version"), 'build-apk берёт версию из package.json');
  assert.ok(script.includes('androidVersionCode'), 'build-apk берёт versionCode из package.json');
  assert.ok(Number.isInteger(pkg.androidVersionCode) && pkg.androidVersionCode > 0, 'package.json: androidVersionCode — целое > 0');
  assert.equal(manifestCode, pkg.androidVersionCode, 'versionCode манифеста совпадает с package.json');
  assert.equal(manifestName, pkg.version, 'versionName манифеста совпадает с package.json');
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
  // WebView игнорирует padding, поэтому insets применяются к FrameLayout-контейнеру.
  assert.match(activity, /FrameLayout root = new FrameLayout/);
  assert.match(activity, /root\.addView\(webView/);
  assert.match(activity, /setContentView\(root\)/);
});

test('обмен: ACTION_SEND, провайдер файлов и открытие .anooplan', () => {
  const manifest = read('android/AndroidManifest.xml');
  // Провайдер для раздачи PDF/XLSX/.anooplan другим приложениям (без androidx).
  assert.match(manifest, /<provider[\s\S]*android:name="\.ShareProvider"/);
  assert.match(manifest, /android:authorities="com\.anooplan\.app\.share"/);
  assert.match(manifest, /android:grantUriPermissions="true"/);
  // Открытие проекта .anooplan из файлового менеджера и из «Поделиться».
  assert.match(manifest, /android:name="android\.intent\.action\.VIEW"/);
  assert.match(manifest, /android:name="android\.intent\.action\.SEND"/);
  assert.match(manifest, /android:mimeType="application\/vnd\.anooplan\.project"/);
  assert.ok(manifest.includes('.anooplan'), 'в манифесте нет связи с расширением .anooplan');
  // Приложение по-прежнему полностью офлайн.
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);

  const provider = read('android/java/com/anooplan/app/ShareProvider.java');
  assert.match(provider, /extends ContentProvider/);
  assert.match(provider, /ParcelFileDescriptor\.MODE_READ_ONLY/);
  assert.match(provider, /application\/vnd\.anooplan\.project/);
  assert.doesNotMatch(provider, /getExternalStorage|WRITE_EXTERNAL_STORAGE/);

  const bridge = read('android/java/com/anooplan/app/NativeBridge.java');
  assert.match(bridge, /public String shareFile\(/);
  assert.match(bridge, /Intent\.ACTION_SEND/);
  assert.match(bridge, /Intent\.createChooser/);
  assert.match(bridge, /public String takePendingFile\(/);

  // Повторное открытие файла при запущенном приложении не создаёт второй экземпляр.
  assert.match(manifest, /android:launchMode="singleTop"/);

  const activity = read('android/java/com/anooplan/app/MainActivity.java');
  assert.match(activity, /Intent\.ACTION_VIEW/);
  assert.match(activity, /Intent\.ACTION_SEND/);
  assert.match(activity, /__anooplanOpenSharedProject/);
  assert.match(activity, /MAX_PROJECT_FILE_BYTES/);
  assert.match(activity, /onNewIntent/);
  assert.match(activity, /onPageFinished/);

  // Сборка компилирует все Java-файлы каталога, включая новый провайдер.
  const script = read('scripts/build-apk.sh');
  assert.match(script, /find "\$ANDROID_DIR\/java" -name '\*\.java'/);
});
