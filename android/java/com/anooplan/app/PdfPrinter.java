package com.anooplan.app;

import android.content.Context;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Печать готового PDF журнала через системный диалог печати.
 *
 * PDF отдаётся в спулер без растеризации: страницы не теряют качество, а печать
 * работает и на принтерах, и через «Сохранить в PDF». PdfRenderer нужен только
 * чтобы узнать количество страниц для макета задания.
 */
public final class PdfPrinter {

    private PdfPrinter() {}

    public static File writeTempFile(Context context, String fileName, byte[] data) throws IOException {
        File dir = new File(context.getCacheDir(), "print");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("нет каталога для печати");
        File file = new File(dir, fileName);
        FileOutputStream out = new FileOutputStream(file);
        try {
            out.write(data);
        } finally {
            out.close();
        }
        return file;
    }

    public static PrintDocumentAdapter adapterFor(Context context, File pdfFile) {
        return new PdfAdapter(pdfFile);
    }

    private static final class PdfAdapter extends PrintDocumentAdapter {

        private final File file;

        PdfAdapter(File file) {
            this.file = file;
        }

        private int pageCount() {
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                return renderer.getPageCount();
            } catch (Exception error) {
                return PrintDocumentInfo.PAGE_COUNT_UNKNOWN;
            }
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             CancellationSignal cancellationSignal, LayoutResultCallback callback, Bundle extras) {
            if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(file.getName())
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(pageCount())
                    .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            CancellationSignal cancellationSignal, WriteResultCallback callback) {
            try (InputStream input = new FileInputStream(file);
                 OutputStream output = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    output.write(buffer, 0, read);
                }
                output.flush();
                callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
            } catch (Exception error) {
                callback.onWriteFailed(error.getMessage() == null ? "Не удалось напечатать" : error.getMessage());
            }
        }
    }
}
