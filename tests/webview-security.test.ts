import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * S-07: статический контракт нативной оболочки. Живой WebView проверяется
 * на устройстве, но эти инварианты не должны теряться при правке Java/манифеста.
 */
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const squash = (text: string): string => text.replace(/\s+/g, ' ');

/** Тело Java-метода по сбалансированным скобкам: комментарии/соседние методы не влияют. */
function methodBody(source: string, method: string): string {
  const signature = new RegExp(`@JavascriptInterface\\s+public\\s+[\\w<>\\[\\]]+\\s+${method}\\s*\\([^)]*\\)\\s*\\{`);
  const match = signature.exec(source);
  assert.ok(match, `метод ${method} найден`);
  let index = match.index + match[0].length;
  let depth = 1;
  const start = index;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `метод ${method}: несбалансированные скобки`);
  return source.slice(start, index - 1);
}

test('JS-мост проверяет origin страницы перед действиями', () => {
  const source = read('android/java/com/anooplan/app/NativeBridge.java');
  const bridge = squash(source);
  assert.match(bridge, /private boolean isTrustedOrigin\(\)/);
  assert.match(bridge, /"https"\.equals\(uri\.getScheme\(\)\)/);
  assert.match(bridge, /AssetServer\.HOST\.equals\(uri\.getHost\(\)\)/);
  for (const method of ['saveFile', 'setDirty', 'exitNow', 'printPdf', 'shareFile', 'takePendingFile', 'vibrate', 'toast']) {
    const body = methodBody(source, method);
    assert.match(body, /isTrustedOrigin\(\)/, `метод ${method} проверяет origin`);
    // Отключённая проверка (if (false && …)) не должна проходить как «есть origin».
    assert.doesNotMatch(body, /if\s*\(\s*false\s*&&/, `метод ${method}: проверка origin отключена`);
  }
  const platform = methodBody(source, 'platform');
  assert.match(platform, /isTrustedOrigin\(\)\s*\?/, 'platform отдаёт android только доверенной странице');
  assert.match(squash(read('android/java/com/anooplan/app/MainActivity.java')), /new NativeBridge\(this, this, webView\)/);
});

test('WebView не открывает file/content и блокирует чужие схемы', () => {
  const activity = squash(read('android/java/com/anooplan/app/MainActivity.java'));
  assert.match(activity, /settings\.setAllowFileAccess\(false\)/);
  assert.match(activity, /settings\.setAllowContentAccess\(false\)/);
  assert.match(activity, /settings\.setAllowFileAccessFromFileURLs\(false\)/);
  assert.match(activity, /settings\.setAllowUniversalAccessFromFileURLs\(false\)/);
  assert.doesNotMatch(activity, /setAllowContentAccess\(true\)/);

  const server = squash(read('android/java/com/anooplan/app/AssetServer.java'));
  assert.match(server, /onPageStarted\(/);
  assert.match(server, /view\.stopLoading\(\)/);
  assert.match(server, /!HOST\.equals\(uri\.getHost\(\)\)\) return notFound\(\)/);
  assert.match(server, /onPageStarted[\s\S]*?view\.loadUrl\(START_URL\)/);
  // Неизвестная схема больше не отдаётся WebView как false (иначе javascript: исполняется).
  assert.match(server, /public boolean shouldOverrideUrlLoading[\s\S]*?return true; \}/);
});

test('манифест остаётся офлайн: без INTERNET и с закрытым backup', () => {
  const manifest = read('android/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:debuggable="false"/);
});
