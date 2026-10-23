package com.anooplan.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.DownloadListener;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * AnOOPlan — нативная оболочка офлайн-версии приложения раскладки кабельных трасс.
 *
 * Статическая сборка веб-приложения лежит в assets/www и отдаётся WebView через
 * {@link AssetServer} по защищённому origin https://appassets.local/, поэтому
 * в WebView доступны localStorage, IndexedDB и crypto.randomUUID().
 */
public class MainActivity extends Activity {

    private static final int REQUEST_FILE_CHOOSER = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#122936"));
        window.setNavigationBarColor(Color.parseColor("#0C1D27"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#122936"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Приложение офлайн: не отправляем запросы в сервис безопасного просмотра.
            settings.setSafeBrowsingEnabled(false);
        }
        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new AssetServer(this));
        webView.setWebChromeClient(new FileChooserClient());
        webView.addJavascriptInterface(new NativeBridge(this), "AnOOPlanNative");
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url == null) return;
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    Toast.makeText(MainActivity.this, "Экспорт выполняется через «Сохранить в Загрузки»", Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "Нет приложения для открытия ссылки", Toast.LENGTH_LONG).show();
                }
            }
        });

        setContentView(webView);
        webView.loadUrl(AssetServer.START_URL);
    }

    private class FileChooserClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = null;
            }
            fileChooserCallback = callback;

            String[] accept = params.getAcceptTypes();
            boolean wantsPdf = false;
            boolean wantsJson = false;
            if (accept != null) {
                for (String type : accept) {
                    if (type == null) continue;
                    String value = type.toLowerCase();
                    if (value.contains("pdf")) wantsPdf = true;
                    else if (value.contains("json")) wantsJson = true;
                }
            }

            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (wantsPdf && !wantsJson) {
                intent.setType("application/pdf");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf"});
            } else {
                // JSON и прочие файлы: показываем все документы, проверка формата — в приложении.
                intent.setType("*/*");
            }

            try {
                startActivityForResult(intent, REQUEST_FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                fileChooserCallback = null;
                Toast.makeText(MainActivity.this, "Не найдено приложение для выбора файла", Toast.LENGTH_LONG).show();
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileChooserCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                    if (result == null) {
                        Uri single = data.getData();
                        if (single != null) result = new Uri[]{single};
                    }
                }
                fileChooserCallback.onReceiveValue(result);
                fileChooserCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finish();
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
