package com.anooplan.app;

import static com.anooplan.app.TextZoom.textZoomPercent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Настройка окна, WebView и слушателя скачиваний — выделено из MainActivity (3.1.0).
 * Инварианты этого класса проверяют тесты webview-security и android-config.
 */
final class WebViewConfigurator {

    private static final String COLOR_BACKGROUND = "#122936";
    private static final String COLOR_NAVIGATION = "#0C1D27";

    private WebViewConfigurator() { }

    /**
     * Android 15 (targetSdk 35) принудительно рисует приложение под системными панелями.
     * Отключаем «вписывание» и сами добавляем отступы WebView по insets (wrapWithInsets).
     * KEEP_SCREEN_ON — черчение трасс на объекте: экран не гаснет, пока приложение видимо.
     */
    static void configureWindow(Window window) {
        if (Build.VERSION.SDK_INT >= 35) {
            window.setDecorFitsSystemWindows(false);
        }
        window.setStatusBarColor(Color.parseColor(COLOR_BACKGROUND));
        window.setNavigationBarColor(Color.parseColor(COLOR_NAVIGATION));
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /**
     * Настройки WebView. Приложение отдаёт свои ассеты через AssetServer; file:// и
     * content:// не должны открывать локальные файлы даже при подмене URL.
     * Системный размер шрифта («Настройки → Экран → Размер шрифта») WebView сам не
     * применяет: отдаём ему fontScale из конфигурации, иначе крупный шрифт
     * игнорируется и интерфейс остаётся нечитаемо мелким (доступность).
     * Тёмная тема WebView определяется темой приложения: в ночном режиме ресурсы
     * берут android/res/values-night/styles.xml, отдельный setForceDark не нужен.
     */
    @SuppressLint("SetJavaScriptEnabled")
    static void configureSettings(WebSettings settings, float fontScale) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(textZoomPercent(fontScale));
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Приложение офлайн: не отправляем запросы в сервис безопасного просмотра.
            settings.setSafeBrowsingEnabled(false);
        }
    }

    /**
     * WebView игнорирует padding для своего содержимого, поэтому отступы edge-to-edge
     * задаём контейнеру: он уменьшает область, в которую WebView раскладывает страницу.
     */
    static FrameLayout wrapWithInsets(Activity activity, WebView webView) {
        webView.setBackgroundColor(Color.parseColor(COLOR_BACKGROUND));
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.parseColor(COLOR_BACKGROUND));
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                if (Build.VERSION.SDK_INT >= 35) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
                    view.setPadding(bars.left, bars.top, bars.right, bottom);
                }
                return insets;
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        return root;
    }

    /**
     * Скачивание разрешаем только для http(s): blob:/data: экспортируются через
     * «Сохранить в Загрузки», а javascript:/intent:/content: не должны уходить
     * во внешние приложения.
     */
    static DownloadListener downloadListener(final Activity activity) {
        return new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url == null) return;
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    Toast.makeText(activity, "Экспорт выполняется через «Сохранить в Загрузки»", Toast.LENGTH_LONG).show();
                    return;
                }
                Uri downloadUri = Uri.parse(url);
                String scheme = downloadUri.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) return;
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, downloadUri));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(activity, "Нет приложения для открытия ссылки", Toast.LENGTH_LONG).show();
                }
            }
        };
    }
}
