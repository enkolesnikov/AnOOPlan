package com.anooplan.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * «Открыть с помощью» / «Поделиться»: читает .anooplan в текст и передаёт его
 * веб-интерфейсу, когда тот готов. Остальные файлы игнорируются — приложение
 * офлайн-проектное. Выделено из MainActivity (3.1.0); поведение не менялось.
 */
class SharedProjectReceiver {

    /** MIME формата проекта AnOOPlan: по нему система предлагает приложение для .anooplan. */
    private static final String ANOOPLAN_MIME = "application/vnd.anooplan.project";
    /** Ограничение на размер открываемого файла проекта (JSON с PDF в base64 бывает большим). */
    private static final int MAX_PROJECT_FILE_BYTES = 40 * 1024 * 1024;

    private final Activity activity;
    private volatile String pendingProjectText;

    SharedProjectReceiver(Activity activity) {
        this.activity = activity;
    }

    /** Запоминает содержимое .anooplan из intent до готовности интерфейса. */
    void capture(Intent intent) {
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
            Toast.makeText(activity, "Не удалось прочитать файл проекта", Toast.LENGTH_LONG).show();
            return;
        }
        pendingProjectText = text;
    }

    /** Забирает отложенный JSON (мост NativeBridge); null — файла нет. */
    String takePendingFile() {
        String text = pendingProjectText;
        pendingProjectText = null;
        return text;
    }

    /** Передаёт открытый файл в интерфейс; если он ещё не готов — останется в pending. */
    void deliver(WebView webView, boolean pageLoaded) {
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

    private String displayNameOf(Uri uri) {
        if (uri == null) return null;
        Cursor cursor = null;
        try {
            cursor = activity.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
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
            input = activity.getContentResolver().openInputStream(uri);
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
}
