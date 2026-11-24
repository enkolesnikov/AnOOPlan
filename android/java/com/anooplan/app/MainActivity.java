package com.anooplan.app;

import static com.anooplan.app.TextZoom.textZoomPercent;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * AnOOPlan — нативная оболочка офлайн-версии приложения раскладки кабельных трасс.
 *
 * Статическая сборка веб-приложения лежит в assets/www и отдаётся WebView через
 * {@link AssetServer} по защищённому origin https://appassets.local/, поэтому
 * в WebView доступны localStorage, IndexedDB и crypto.randomUUID().
 *
 * Activity только связывает помощников (декомпозиция 3.1.0):
 * {@link WebViewConfigurator} — окно и настройки WebView, {@link JsDialogClient} —
 * выбор файлов и JS-диалоги, {@link SharedProjectReceiver} — открытие .anooplan
 * из системы, {@link ExitController} — «Назад» и выход с сохранением,
 * {@link PrintJobs} — печать PDF, {@link TextZoom} — системный масштаб шрифта.
 */
public class MainActivity extends Activity implements NativeBridge.Host {

    private WebView webView;
    private JsDialogClient jsDialogs;
    private SharedProjectReceiver sharedProjects;
    private ExitController exitController;
    private volatile boolean pageLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Отладка WebView нужна только в debug-сборке: в релизе она открывает
        // удалённый доступ к странице и хранилищу проекта. Вызываем до создания WebView.
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        WebViewConfigurator.configureWindow(getWindow());

        webView = new WebView(this);
        FrameLayout root = WebViewConfigurator.wrapWithInsets(this, webView);
        WebViewConfigurator.configureSettings(webView.getSettings(),
                getResources().getConfiguration().fontScale);

        jsDialogs = new JsDialogClient(this);
        sharedProjects = new SharedProjectReceiver(this);
        exitController = new ExitController(this);

        final NativeBridge bridge = new NativeBridge(this, this);
        webView.setWebViewClient(new AssetServer(this) {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // Мост исполняется на потоке JavaBridge и не может спрашивать URL
                // у WebView — запоминаем его здесь, на главном потоке.
                bridge.onPageUrl(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                sharedProjects.deliver(webView, true);
            }
        });
        webView.setWebChromeClient(jsDialogs);
        webView.addJavascriptInterface(bridge, "AnOOPlanNative");
        webView.setDownloadListener(WebViewConfigurator.downloadListener(this));

        setContentView(root);
        root.requestApplyInsets();
        sharedProjects.capture(getIntent());
        webView.loadUrl(AssetServer.START_URL);
    }

    /**
     * Смена системного размера шрифта приходит без пересоздания Activity
     * (см. {@code android:configChanges} в манифесте). WebView запоминает textZoom
     * в своих настройках, поэтому переносим новый масштаб вручную: иначе крупный
     * шрифт применится только после перезапуска приложения.
     *
     * Тема здесь не обновляется: {@code uiMode} не входит в configChanges, поэтому
     * при смене системной темы Activity пересоздаётся и берёт тёмный {@code values-night}.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView != null) {
            webView.getSettings().setTextZoom(textZoomPercent(newConfig.fontScale));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        sharedProjects.capture(intent);
        sharedProjects.deliver(webView, pageLoaded);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (jsDialogs != null && jsDialogs.handleActivityResult(requestCode, resultCode, data)) {
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ── NativeBridge.Host ────────────────────────────────────────────────────

    @Override
    public void onDirtyChanged(boolean dirty) {
        exitController.onDirtyChanged(dirty);
    }

    @Override
    public void onExitRequested() {
        exitController.onExitRequested();
    }

    @Override
    public String takePendingFile() {
        return sharedProjects.takePendingFile();
    }

    @Override
    public void onPrintRequested(String name, byte[] pdf) {
        PrintJobs.print(this, name, pdf);
    }

    // ── «Назад»: сначала закрыть веб-слой, и только потом выходить ──────────

    @Override
    public void onBackPressed() {
        exitController.onBackPressed(webView);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AnOOPlanNative");
            webView.destroy();
        }
        super.onDestroy();
    }
}
