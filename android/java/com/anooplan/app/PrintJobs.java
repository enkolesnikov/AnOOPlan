package com.anooplan.app;

import android.app.Activity;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.widget.Toast;

import java.io.File;

/**
 * Печать PDF журнала через системный PrintManager: готовый PDF уходит в спулер
 * без растеризации. Временный файл пишет {@link PdfPrinter}.
 * Выделено из MainActivity (3.1.0); поведение не менялось.
 */
final class PrintJobs {

    private PrintJobs() { }

    static void print(final Activity activity, final String name, final byte[] pdf) {
        activity.runOnUiThread(new Runnable() {
            public void run() {
                try {
                    String jobName = name == null || name.trim().isEmpty() ? "AnOOPlan" : name.trim();
                    File file = PdfPrinter.writeTempFile(activity, "anooplan-print.pdf", pdf);
                    PrintManager manager = (PrintManager) activity.getSystemService(Activity.PRINT_SERVICE);
                    if (manager == null) {
                        Toast.makeText(activity, "Печать недоступна на этом устройстве", Toast.LENGTH_LONG).show();
                        return;
                    }
                    PrintAttributes attributes = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape())
                            .setResolution(new PrintAttributes.Resolution("300dpi", "300 dpi", 300, 300))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                    manager.print(jobName, PdfPrinter.adapterFor(activity, file), attributes);
                } catch (Exception error) {
                    Toast.makeText(activity, "Не удалось открыть печать: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }
}
