import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * S-07: статический контракт нативной оболочки. Живой WebView проверяется
 * на устройстве, но эти инварианты не должны теряться при правке Java/манифеста.
 */
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const squash = (text: string): string => text.replace(/\s+/g, ' ');

test('JS-мост проверяет origin страницы перед действиями', () => {
  const bridge = squash(read('android/java/com/anooplan/app/NativeBridge.java'));
  assert.match(bridge, /private boolean isTrustedOrigin\(\)/);
  assert.match(bridge, /"https"\.equals\(uri\.getScheme\(\)\)/);
  assert.match(bridge, /AssetServer\.HOST\.equals\(uri\.getHost\(\)\)/);
  // Каждый @JavascriptInterface метод должен начинаться с проверки origin.
  for (const method of ['platform', 'saveFile', 'setDirty', 'exitNow', 'printPdf', 'shareFile', 'takePendingFile', 'vibrate', 'toast']) {
    const body = bridge.match(new RegExp(`@JavascriptInterface public [^ ]+ ${method}\\([^)]*\\) \\{`))?.[0];
    assert.ok(body, `метод ${method} найден`);
    const after = bridge.slice(bridge.indexOf(body) + body.length, bridge.indexOf(body) + body.length + 260);
    assert.match(after, /isTrustedOrigin\(\)/, `метод ${method} проверяет origin`);
  }
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
