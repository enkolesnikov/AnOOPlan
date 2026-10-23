package com.anooplan.app;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Мост в JavaScript: сохранение экспортированных файлов в «Загрузки/AnOOPlan»,
 * состояние несохранённых изменений, тактильный отклик и управляемый выход.
 */
public class NativeBridge {

    /** Колбэки, которые реализует активити. */
    interface Host {
        void onDirtyChanged(boolean dirty);

        void onExitRequested();
    }

    private final Context context;
    private final Host host;

    NativeBridge(Context context, Host host) {
        this.context = context.getApplicationContext();
        this.host = host;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    /**
     * @return "ok:<относительный путь>" при успехе, "err:<текст>" при ошибке.
     */
    @JavascriptInterface
    public String saveFile(String name, String base64, String mime) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            String fileName = name == null || name.trim().isEmpty() ? "anooplan.dat" : name.trim();
            fileName = fileName.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_");
            String mimeType = mime == null || mime.trim().isEmpty() ? "application/octet-stream" : mime;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return saveWithMediaStore(fileName, mimeType, data);
            }
            return saveToAppDownloads(fileName, data);
        } catch (Exception e) {
            return "err:" + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    private String saveWithMediaStore(String fileName, String mimeType, byte[] data) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AnOOPlan");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri uri = context.getContentResolver().insert(collection, values);
        if (uri == null) return "err: не удалось создать файл в «Загрузках»";

        OutputStream out = context.getContentResolver().openOutputStream(uri);
        if (out == null) {
            context.getContentResolver().delete(uri, null, null);
            return "err: нет доступа к «Загрузкам»";
        }
        try {
            out.write(data);
            out.flush();
        } finally {
            out.close();
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        context.getContentResolver().update(uri, done, null, null);
        return "ok:Download/AnOOPlan/" + fileName;
    }

    private String saveToAppDownloads(String fileName, byte[] data) throws Exception {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = new File(context.getFilesDir(), "Download");
        if (!dir.exists() && !dir.mkdirs()) return "err: не удалось создать папку";
        File target = new File(dir, fileName);
        FileOutputStream out = new FileOutputStream(target);
        try {
            out.write(data);
        } finally {
            out.close();
        }
        return "ok:" + target.getAbsolutePath();
    }

    /** Приложение сообщает, есть ли несохранённые изменения — от этого зависит диалог выхода. */
    @JavascriptInterface
    public void setDirty(boolean dirty) {
        if (host != null) host.onDirtyChanged(dirty);
    }

    /** Вызывается веб-частью после сохранения: можно закрывать приложение. */
    @JavascriptInterface
    public void exitNow() {
        if (host != null) host.onExitRequested();
    }

    /** Короткая вибрация: попадание в привязку, долгое нажатие. */
    @JavascriptInterface
    public void vibrate(int milliseconds) {
        try {
            int duration = Math.max(1, Math.min(60, milliseconds));
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(duration);
            }
        } catch (Exception ignored) {
            // вибрация не критична для работы приложения
        }
    }

    @JavascriptInterface
    public void toast(final String text) {
        Toast.makeText(context, text == null ? "" : text, Toast.LENGTH_LONG).show();
    }
}
