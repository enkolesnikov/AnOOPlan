package com.anooplan.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.DownloadListener;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.Toast;

/**
 * AnOOPlan — нативная оболочка офлайн-версии приложения раскладки кабельных трасс.
 *
 * Статическая сборка веб-приложения лежит в assets/www и отдаётся WebView через
 * {@link AssetServer} по защищённому origin https://appassets.local/, поэтому
 * в WebView доступны localStorage, IndexedDB и crypto.randomUUID().
 *
 * Оболочка добавляет то, чего нет у сайта: системные диалоги, сохранение перед выходом,
 * горящий экран при работе с планом и тактильный отклик.
 */
public class MainActivity extends Activity implements NativeBridge.Host {

    private static final int REQUEST_FILE_CHOOSER = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private volatile boolean pageDirty = false;
    private volatile boolean exiting = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#122936"));
        window.setNavigationBarColor(Color.parseColor("#0C1D27"));
        // Черчение трасс на объекте: экран не должен гаснуть, пока приложение на переднем плане.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

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
        webView.addJavascriptInterface(new NativeBridge(this, this), "AnOOPlanNative");
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

    /** Выбор PDF-плана или JSON-копии из памяти телефона + системные диалоги JS. */
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

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("ОК", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialog, int which) {
                            result.confirm();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        public void onCancel(DialogInterface dialog) {
                            result.cancel();
                        }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("Да", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialog, int which) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton("Отмена", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialog, int which) {
                            result.cancel();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        public void onCancel(DialogInterface dialog) {
                            result.cancel();
                        }
                    })
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
            final EditText input = new EditText(MainActivity.this);
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setSelectAllOnFocus(true);
            String hint = message == null ? "" : message.toLowerCase();
            if (hint.contains("метр") || hint.contains("расстоян") || hint.contains("число")) {
                input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
            }

            AlertDialog dialog = new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("ОК", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int which) {
                            result.confirm(input.getText().toString());
                        }
                    })
                    .setNegativeButton("Отмена", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int which) {
                            result.cancel();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .create();
            dialog.setOnShowListener(new DialogInterface.OnShowListener() {
                public void onShow(DialogInterface d) {
                    input.requestFocus();
                    InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                    if (keyboard != null) keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
                }
            });
            dialog.show();
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

    // ── NativeBridge.Host ────────────────────────────────────────────────────

    @Override
    public void onDirtyChanged(boolean dirty) {
        pageDirty = dirty;
    }

    @Override
    public void onExitRequested() {
        exiting = true;
        runOnUiThread(new Runnable() {
            public void run() {
                finish();
            }
        });
    }

    // ── «Назад»: сохранить перед выходом ─────────────────────────────────────

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (!pageDirty) {
            finish();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Есть несохранённые изменения")
                .setMessage("Сохранить проект перед выходом?")
                .setPositiveButton("Сохранить", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        saveAndExit();
                    }
                })
                .setNegativeButton("Выйти", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        finish();
                    }
                })
                .setNeutralButton("Отмена", null)
                .show();
    }

    /** Просит веб-часть сохранить проект, затем закрывает приложение. */
    private void saveAndExit() {
        exiting = false;
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{if(window.__anooplanSaveAndExit){window.__anooplanSaveAndExit();return 'ok';}}catch(e){}return 'manual';})()",
                new ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        if (value != null && value.contains("manual")) {
                            exiting = true;
                            finish();
                        }
                    }
                });
        webView.postDelayed(new Runnable() {
            public void run() {
                if (!exiting) {
                    exiting = true;
                    finish();
                }
            }
        }, 2500);
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
