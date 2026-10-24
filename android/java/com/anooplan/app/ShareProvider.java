package com.anooplan.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * ContentProvider для ACTION_SEND: отдаёт файлы из cache/share другим приложениям.
 *
 * Сборка APK обходится без Gradle и внешних зависимостей, поэтому androidx FileProvider
 * недоступен — этот провайдер делает то же самое: раздаёт один файл по content:// URI
 * с правом чтения, выданным через FLAG_GRANT_READ_URI_PERMISSION.
 */
public class ShareProvider extends ContentProvider {

    /** Суффикс authority: в манифесте закреплён com.anooplan.app.share. */
    public static final String AUTHORITY_SUFFIX = ".share";
    /** Подпапка кэша, куда NativeBridge пишет файл перед отправкой. */
    public static final String DIR = "share";

    static File shareDir(Context context) {
        return new File(context.getCacheDir(), DIR);
    }

    static Uri uriFor(Context context, File file) {
        return new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + AUTHORITY_SUFFIX)
                .appendPath(file.getName())
                .build();
    }

    /** Только имя файла в нашей папке: никаких ../ и путей извне. */
    private File fileFor(Uri uri) {
        if (uri == null) return null;
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) return null;
        if (name.contains("/") || name.contains("\\") || name.contains("..")) return null;
        Context context = currentContext;
        if (context == null) return null;
        File file = new File(shareDir(context), name);
        return file.isFile() ? file : null;
    }

    private Context currentContext;

    @Override
    public boolean onCreate() {
        currentContext = getContext();
        return currentContext != null;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = fileFor(uri);
        if (file == null) return null;
        String[] columns = projection != null && projection.length > 0
                ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] row = new Object[columns.length];
        for (int index = 0; index < columns.length; index++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[index])) row[index] = file.getName();
            else if (OpenableColumns.SIZE.equals(columns[index])) row[index] = file.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        File file = fileFor(uri);
        if (file == null) return "application/octet-stream";
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "application/octet-stream";
        String extension = name.substring(dot + 1).toLowerCase();
        if ("anooplan".equals(extension)) return "application/vnd.anooplan.project";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = fileFor(uri);
        if (file == null) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Только чтение");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Только чтение");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Только чтение");
    }
}
