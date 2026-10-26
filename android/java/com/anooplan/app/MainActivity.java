package com.anooplan.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
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
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

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
    private volatile boolean pageLoaded = false;
    private volatile String pendingProjectText = null;
    private Uri pendingCameraUri = null;

    /** MIME формата проекта AnOOPlan: по нему система предлагает приложение для .anooplan. */
    private static final String ANOOPLAN_MIME = "application/vnd.anooplan.project";
    /** Ограничение на размер открываемого файла проекта (JSON с PDF в base64 бывает большим). */
    private static final int MAX_PROJECT_FILE_BYTES = 40 * 1024 * 1024;

    /** Границы textZoom, %: совпадают с TEXT_ZOOM_MIN/MAX в src/a11y.ts. */
    private static final int TEXT_ZOOM_MIN = 85;
    private static final int TEXT_ZOOM_MAX = 160;
    /** textZoom по умолчанию, %: для некорректного системного fontScale. */
    private static final int TEXT_ZOOM_DEFAULT = 100;

    /**
     * Приводит системный масштаб шрифта (fontScale, 1.0 = 100 %) к проценту textZoom.
     * Значение округляется и зажимается в диапазон 85–160 %, некорректное даёт 100 %.
     * Зеркало {@code resolveTextZoom} из src/a11y.ts (Java не импортирует TypeScript).
     */
    private static int textZoomPercent(float fontScale) {
        if (Float.isNaN(fontScale) || Float.isInfinite(fontScale) || fontScale <= 0f) {
            return TEXT_ZOOM_DEFAULT;
        }
        int percent = Math.round(fontScale * 100f);
        return Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, percent));
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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Отладка WebView нужна только в debug-сборке: в релизе она открывает
        // удалённый доступ к странице и хранилищу проекта. Вызываем до создания WebView.
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        Window window = getWindow();
        // Android 15 (targetSdk 35) принудительно рисует приложение под системными панелями.
        // Отключаем «вписывание» и сами добавляем отступы WebView по insets.
        if (Build.VERSION.SDK_INT >= 35) {
            window.setDecorFitsSystemWindows(false);
        }
        window.setStatusBarColor(Color.parseColor("#122936"));
        window.setNavigationBarColor(Color.parseColor("#0C1D27"));
        // Черчение трасс на объекте: экран не должен гаснуть, пока приложение на переднем плане.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#122936"));

        // WebView игнорирует padding для своего содержимого, поэтому отступы edge-to-edge
        // задаём контейнеру: он уменьшает область, в которую WebView раскладывает страницу.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#122936"));
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
        // Системный размер шрифта («Настройки → Экран → Размер шрифта») WebView сам не
        // применяет: отдаём ему fontScale из конфигурации, иначе крупный шрифт
        // игнорируется и интерфейс остаётся нечитаемо мелким (доступность).
        settings.setTextZoom(textZoomPercent(getResources().getConfiguration().fontScale));
        // Тёмная тема WebView определяется темой приложения: в ночном режиме ресурсы
        // берут android/res/values-night/styles.xml, и prefers-color-scheme становится dark.
        // Отдельный setForceDark/setAlgorithmicDarkeningAllowed не нужен.
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Приложение офлайн: не отправляем запросы в сервис безопасного просмотра.
            settings.setSafeBrowsingEnabled(false);
        }
        webView.setWebViewClient(new AssetServer(this) {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                deliverPendingFile();
            }
        });
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

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.requestApplyInsets();
        captureIntent(getIntent());
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
            boolean wantsImage = false;
            if (accept != null) {
                for (String type : accept) {
                    if (type == null) continue;
                    String value = type.toLowerCase();
                    if (value.contains("pdf")) wantsPdf = true;
                    else if (value.contains("json")) wantsJson = true;
                    else if (value.startsWith("image/")) wantsImage = true;
                }
            }

            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (wantsImage && !wantsJson && !wantsPdf && params.isCaptureEnabled()
                    && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // «Снять» в приложении: системная камера пишет снимок в нашу запись MediaStore.
                try {
                    startActivityForResult(buildCameraIntent(), REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    // камеры нет — покажем обычный выбор изображения
                }
            }
            if (wantsPdf && !wantsJson) {
                intent.setType("application/pdf");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf"});
            } else if (wantsImage && !wantsJson) {
                // Фото оборудования: только изображения.
                intent.setType("image/*");
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
                if (resultCode == RESULT_OK) {
                    if (pendingCameraUri != null) {
                        result = new Uri[]{pendingCameraUri};
                    } else if (data != null) {
                        result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                        if (result == null) {
                            Uri single = data.getData();
                            if (single != null) result = new Uri[]{single};
                        }
                    }
                }
                if (result == null && pendingCameraUri != null) {
                    try {
                        getContentResolver().delete(pendingCameraUri, null, null);
                    } catch (Exception ignored) {
                        // пустая запись MediaStore не мешает работе
                    }
                }
                pendingCameraUri = null;
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

    @Override
    public String takePendingFile() {
        String text = pendingProjectText;
        pendingProjectText = null;
        return text;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIntent(intent);
        deliverPendingFile();
    }

    /**
     * «Открыть с помощью» / «Поделиться»: читает .anooplan в текст и запоминает до
     * готовности интерфейса. Остальные файлы игнорируются — приложение офлайн-проектное.
     */
    private void captureIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean fromView = Intent.ACTION_VIEW.equals(action);
        boolean fromSend = Intent.ACTION_SEND.equals(action);
        if (!fromView && !fromSend) return;

        Uri uri = intent.getData();
        if (uri == null && fromSend) {
            Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (extra instanceof Uri) uri = (Uri) extra;
        }
        if (uri == null) return;

        String type = intent.getType();
        String displayName = displayNameOf(uri);
        boolean ours = ANOOPLAN_MIME.equals(type)
                || (displayName != null && displayName.toLowerCase().endsWith(".anooplan"));
        if (!ours) return;

        String text = readText(uri);
        if (text == null) {
            Toast.makeText(MainActivity.this, "Не удалось прочитать файл проекта", Toast.LENGTH_LONG).show();
            return;
        }
        pendingProjectText = text;
    }

    private String displayNameOf(Uri uri) {
        if (uri == null) return null;
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // провайдер может не поддерживать query — проверим MIME
        } finally {
            if (cursor != null) cursor.close();
        }
        String last = uri.getLastPathSegment();
        return last == null ? null : last;
    }

    private String readText(Uri uri) {
        InputStream input = null;
        try {
            input = getContentResolver().openInputStream(uri);
            if (input == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = input.read(chunk)) > 0) {
                if (buffer.size() + read > MAX_PROJECT_FILE_BYTES) return null;
                buffer.write(chunk, 0, read);
            }
            return buffer.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (input != null) {
                try { input.close(); } catch (Exception ignored) { }
            }
        }
    }

    /** Передаёт открытый файл в интерфейс; если он ещё не готов — останется в pending. */
    private void deliverPendingFile() {
        final String text = pendingProjectText;
        if (!pageLoaded || text == null || webView == null) return;
        String script = "(function(){try{if(typeof window.__anooplanOpenSharedProject==='function'){"
                + "window.__anooplanOpenSharedProject(" + JSONObject.quote(text) + ");return 'ok';}"
                + "}catch(e){return 'error';}return 'pending';})()";
        webView.evaluateJavascript(script, new ValueCallback<String>() {
            public void onReceiveValue(String value) {
                if (value != null && value.contains("ok")) pendingProjectText = null;
            }
        });
    }

    @Override
    public void onPrintRequested(final String name, final byte[] pdf) {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    String jobName = name == null || name.trim().isEmpty() ? "AnOOPlan" : name.trim();
                    java.io.File file = PdfPrinter.writeTempFile(MainActivity.this, "anooplan-print.pdf", pdf);
                    PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                    if (manager == null) {
                        Toast.makeText(MainActivity.this, "Печать недоступна на этом устройстве", Toast.LENGTH_LONG).show();
                        return;
                    }
                    PrintAttributes attributes = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape())
                            .setResolution(new PrintAttributes.Resolution("300dpi", "300 dpi", 300, 300))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                    manager.print(jobName, PdfPrinter.adapterFor(MainActivity.this, file), attributes);
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть печать: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    /** Системная камера пишет снимок в нашу запись MediaStore — FileProvider не нужен. */
    private Intent buildCameraIntent() {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "anooplan-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AnOOPlan");
        pendingCameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (pendingCameraUri != null) intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
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
