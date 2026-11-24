package com.anooplan.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;

/**
 * «Назад» и выход с сохранением. Первое нажатие Back всегда отдаём веб-части (UX-02):
 * открытая шторка, модалка или панель свойств закрываются, не завершая приложение.
 * Только если веб-слой ответил false, работает нативная логика: история WebView,
 * затем диалог выхода с сохранением. Выделено из MainActivity (3.1.0).
 */
class ExitController {

    /** JS-обработчик Back: true — верхний веб-слой закрыт, Activity завершать нельзя. */
    private static final String HANDLE_BACK_JS =
            "(function(){try{if(typeof window.__anooplanHandleBack==='function'){"
                    + "return window.__anooplanHandleBack()?'true':'false';}"
                    + "}catch(e){}return 'false';})()";

    /** Просит веб-часть сохранить проект; после сохранения она вызывает мост exitNow(). */
    private static final String SAVE_AND_EXIT_JS =
            "(function(){try{if(window.__anooplanSaveAndExit){window.__anooplanSaveAndExit();return 'ok';}}catch(e){}return 'manual';})()";

    private final Activity activity;
    private volatile boolean pageDirty;
    private volatile boolean exiting;

    ExitController(Activity activity) {
        this.activity = activity;
    }

    /** Приложение сообщает, есть ли несохранённые изменения — от этого зависит диалог выхода. */
    void onDirtyChanged(boolean dirty) {
        pageDirty = dirty;
    }

    /** Вызывается мостом после сохранения из веб-части: можно закрывать приложение. */
    void onExitRequested() {
        exiting = true;
        activity.runOnUiThread(new Runnable() {
            public void run() {
                activity.finish();
            }
        });
    }

    void onBackPressed(final WebView webView) {
        if (webView == null || activity.isFinishing()) {
            handleNativeBack(webView);
            return;
        }
        try {
            webView.evaluateJavascript(HANDLE_BACK_JS, new ValueCallback<String>() {
                public void onReceiveValue(String value) {
                    if (value != null && value.contains("true")) return;
                    handleNativeBack(webView);
                }
            });
        } catch (RuntimeException error) {
            handleNativeBack(webView);
        }
    }

    /** Back не обработан веб-слоем: история WebView, затем диалог выхода. */
    private void handleNativeBack(final WebView webView) {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (!pageDirty) {
            activity.finish();
            return;
        }
        new AlertDialog.Builder(activity)
                .setTitle("Есть несохранённые изменения")
                .setMessage("Сохранить проект перед выходом?")
                .setPositiveButton("Сохранить", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        saveAndExit(webView);
                    }
                })
                .setNegativeButton("Выйти", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        activity.finish();
                    }
                })
                .setNeutralButton("Отмена", null)
                .show();
    }

    /** Просит веб-часть сохранить проект, затем закрывает приложение. */
    private void saveAndExit(final WebView webView) {
        exiting = false;
        if (webView == null) {
            activity.finish();
            return;
        }
        webView.evaluateJavascript(SAVE_AND_EXIT_JS, new ValueCallback<String>() {
            public void onReceiveValue(String value) {
                if (value != null && value.contains("manual")) {
                    exiting = true;
                    activity.finish();
                }
            }
        });
    }
}
