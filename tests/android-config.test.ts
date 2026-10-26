import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '../src/a11y';

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

// ── Доступность: textZoom, тёмная тема, высокий контраст ─────────────────

/** Тело CSS-блока по заголовку: от первой «{» до парной «}» с учётом вложенности. */
function cssBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  assert.ok(start >= 0, `в styles.css нет блока ${header}`);
  let depth = 0;
  const open = css.indexOf('{', start);
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return '';
}

/** CSS-переменные блока в виде карты имя → значение. */
function cssVariables(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}

/** Относительная яркость sRGB по WCAG 2.x. */
function relativeLuminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `ожидался цвет #rrggbb, получено: ${hex}`);
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Коэффициент контраста WCAG (1…21). */
function contrastRatio(first: string, second: string): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test('доступность: MainActivity масштабирует текст по системному fontScale', () => {
  const activity = read('android/java/com/anooplan/app/MainActivity.java');
  // fontScale — из конфигурации Android, setTextZoom получает вычисленный процент.
  assert.match(activity, /getResources\(\)\.getConfiguration\(\)\.fontScale/);
  assert.match(activity, /settings\.setTextZoom\(\s*textZoomPercent\(/);
  assert.doesNotMatch(activity, /setTextZoom\(100\)/, 'жёсткий setTextZoom(100) игнорировал системный шрифт');
  assert.match(activity, /Math\.round\(fontScale \* 100f\)/);
  assert.match(activity, /Math\.min\(TEXT_ZOOM_MAX, Math\.max\(TEXT_ZOOM_MIN/, 'значение зажимается в 85–160 %');
  assert.match(
    activity,
    /Float\.isNaN\(fontScale\)[\s\S]*Float\.isInfinite\(fontScale\)[\s\S]*TEXT_ZOOM_DEFAULT/,
    'некорректный fontScale даёт 100 %',
  );
  // Границы — единый источник: Java и TypeScript не должны разъезжаться.
  const script = read('src/a11y.ts');
  for (const name of ['TEXT_ZOOM_MIN', 'TEXT_ZOOM_MAX', 'TEXT_ZOOM_DEFAULT']) {
    const pattern = new RegExp(`${name}\\s*=\\s*(\\d+)`);
    const javaValue = pattern.exec(activity)?.[1];
    assert.ok(javaValue, `${name} не найден в MainActivity.java`);
    assert.equal(javaValue, pattern.exec(script)?.[1], `${name} совпадает в MainActivity.java и src/a11y.ts`);
  }
});

test('доступность: тёмная тема APK через values-night и textZoom при смене шрифта', () => {
  const activity = read('android/java/com/anooplan/app/MainActivity.java');
  const manifest = read('android/AndroidManifest.xml');
  // WebView определяет prefers-color-scheme по теме приложения. Проверено на Android 15:
  // со светлой темой (Theme.Material.Light) APK оставался светлым даже в ночном режиме,
  // с values-night/styles.xml — переключается. Без этого CSS-тёмная тема в APK не работает.
  const night = read('android/res/values-night/styles.xml');
  assert.match(night, /<style name="AppTheme" parent="@android:style\/Theme\.Material\.NoActionBar">/);
  assert.doesNotMatch(night, /Theme\.Material\.Light/, 'ночной AppTheme не должен наследовать светлую тему');
  // Смена системного размера шрифта не пересоздаёт Activity — WebView обновляем вручную.
  assert.match(activity, /import android\.content\.res\.Configuration;/);
  assert.match(activity, /onConfigurationChanged\(Configuration newConfig\)[\s\S]*setTextZoom\(\s*textZoomPercent\(/);
  // uiMode не в configChanges: смена темы пересоздаёт Activity и применяет values-night.
  assert.match(manifest, /android:configChanges="[^"]*fontScale[^"]*"/);
  assert.doesNotMatch(
    manifest,
    /android:configChanges="[^"]*uiMode[^"]*"/,
    'uiMode не перехватываем: иначе тёмная тема применится только после перезапуска',
  );
});

test('доступность: theme-color с media и color-scheme в index.html', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="color-scheme" content="light dark"/);
  const themes = new Map<string, string>();
  const pattern = /<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (light|dark)\)"/g;
  for (const match of html.matchAll(pattern)) themes.set(match[2], match[1]);
  assert.equal(themes.size, 2, 'нужны theme-color для светлой и тёмной темы');
  // Значения берём из src/a11y.ts, чтобы HTML и Java/CSS не разъезжались.
  assert.equal(themes.get('light'), THEME_COLOR_LIGHT);
  assert.equal(themes.get('dark'), THEME_COLOR_DARK);
});

test('стили: тёмная тема переопределяет цвета и сохраняет контраст ≥ 7:1', () => {
  const css = read('src/styles.css');
  const dark = cssBlock(css, '@media (prefers-color-scheme: dark)');
  assert.match(dark, /color-scheme: dark/);
  const variables = cssVariables(dark);
  for (const name of ['--surface', '--surface-2', '--surface-3', '--text', '--muted',
    '--border', '--border-soft', '--shadow', '--accent-soft']) {
    assert.ok(variables.has(name), `в тёмной теме не переопределена ${name}`);
  }
  for (const surface of ['--surface', '--surface-2', '--surface-3']) {
    const ratio = contrastRatio(variables.get('--text')!, variables.get(surface)!);
    assert.ok(ratio >= 7, `основной текст на ${surface}: ${ratio.toFixed(2)}:1, нужно ≥ 7:1`);
  }
  assert.ok(contrastRatio(variables.get('--muted')!, variables.get('--surface')!) >= 4.5, 'вторичный текст на --surface');
  assert.ok(contrastRatio(variables.get('--accent-2')!, variables.get('--surface')!) >= 4.5, 'акцентный текст на --surface');
  // Белая подпись на залитой кнопке primary (button.primary { color: #fff }).
  assert.ok(contrastRatio('#ffffff', variables.get('--accent')!) >= 4.5, 'белый текст на --accent');
});

test('стили: высокий контраст, forced-colors и reduced-motion', () => {
  const css = read('src/styles.css');
  const more = cssBlock(css, '@media (prefers-contrast: more)');
  assert.ok(more.includes('--muted'), 'высокий контраст усиливает вторичный текст');
  assert.ok(more.includes('border-color: var(--text)'), 'высокий контраст усиливает границы');
  assert.match(more, /outline-width: 4px/);
  const darkMore = cssBlock(css, '@media (prefers-color-scheme: dark) and (prefers-contrast: more)');
  assert.ok(darkMore.includes('--text'), 'тёмная тема + высокий контраст дают белый текст');
  const forced = cssBlock(css, '@media (forced-colors: active)');
  assert.ok(forced.includes('CanvasText'), 'в forced-colors используем системный цвет границ');
  assert.ok(forced.includes('Highlight'), 'выделение в forced-colors — системным Highlight');
  assert.ok(forced.includes('forced-color-adjust'), 'план сохраняет цвета как изображение');
  const reduced = cssBlock(css, '@media (prefers-reduced-motion: reduce)');
  assert.ok(reduced.includes('animation-duration'));
  assert.ok(reduced.includes('transition-duration'));
  assert.ok(reduced.includes('scroll-behavior'));
});

test('стили: textZoom — min-height и переносы вместо обрезки', () => {
  const css = read('src/styles.css');
  assert.match(css, /text-size-adjust: 100%/, 'отключаем автоувеличение текста поверх textZoom');
  assert.match(css, /overflow-wrap: anywhere/);
  // Фиксированные высоты интерактивных элементов заменены минимумами.
  assert.match(css, /\.menu-toggle \{[^}]*min-height: 44px/);
  assert.match(css, /\.props-fab \{[^}]*min-height: 54px/);
  assert.match(css, /\.properties-close \{[^}]*min-height: 40px/);
  assert.match(css, /\.history-fab button \{[^}]*min-height: 46px/);
  assert.match(css, /\.photo-add \{[^}]*min-height: 92px/);
  assert.doesNotMatch(css, /height: 42px/, 'жёсткая высота 42 px у кнопки меню');
  // Подпись объекта в списке больше не обрезается многоточием в одну строку.
  assert.match(css, /\.object-row small \{[^}]*overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /\.object-row small \{[^}]*text-overflow: ellipsis/);
});
