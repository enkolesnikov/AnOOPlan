import { loadBitmap } from './compat';
import { logDiagnostic } from './diagnostics';

/** Фото с телефона уменьшаем до 1600 px по длинной стороне: журнал не раздувается. */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await loadBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); return file; }
    bitmap.draw(context, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    bitmap.close();
    return blob || file;
  } catch (error) {
    logDiagnostic('error', error, 'compressPhoto');
    return file;
  }
}
