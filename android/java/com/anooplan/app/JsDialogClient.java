package com.anooplan.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.Toast;

/**
 * Выбор PDF-плана, JSON-копии или фото из памяти телефона и системные диалоги JS
 * (alert/confirm/prompt). Выделено из MainActivity (3.1.0); поведение не менялось.
 */
class JsDialogClient extends WebChromeClient {

    static final int REQUEST_FILE_CHOOSER = 1001;

    private final Activity activity;
    private ValueCallback<Uri[]> fileChooserCallback;
    private Uri pendingCameraUri;

    JsDialogClient(Activity activity) {
        this.activity = activity;
    }

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
                activity.startActivityForResult(buildCameraIntent(), REQUEST_FILE_CHOOSER);
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
            activity.startActivityForResult(intent, REQUEST_FILE_CHOOSER);
        } catch (ActivityNotFoundException e) {
            fileChooserCallback = null;
            Toast.makeText(activity, "Не найдено приложение для выбора файла", Toast.LENGTH_LONG).show();
            return false;
        }
        return true;
    }

    /** Результат выбора файла/камеры; true — результат наш и обработан. */
    boolean handleActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_FILE_CHOOSER) return false;
        if (fileChooserCallback != null) {
            Uri[] result = null;
            if (resultCode == Activity.RESULT_OK) {
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
                    activity.getContentResolver().delete(pendingCameraUri, null, null);
                } catch (Exception ignored) {
                    // пустая запись MediaStore не мешает работе
                }
            }
            pendingCameraUri = null;
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
        }
        return true;
    }

    /** Системная камера пишет снимок в нашу запись MediaStore — FileProvider не нужен. */
    private Intent buildCameraIntent() {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "anooplan-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AnOOPlan");
        pendingCameraUri = activity.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (pendingCameraUri != null) intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    @Override
    public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
        new AlertDialog.Builder(activity)
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
        new AlertDialog.Builder(activity)
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
        final EditText input = new EditText(activity);
        input.setText(defaultValue == null ? "" : defaultValue);
        input.setSelectAllOnFocus(true);
        String hint = message == null ? "" : message.toLowerCase();
        if (hint.contains("метр") || hint.contains("расстоян") || hint.contains("число")) {
            input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        }

        AlertDialog dialog = new AlertDialog.Builder(activity)
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
                InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
            }
        });
        dialog.show();
        return true;
    }
}
