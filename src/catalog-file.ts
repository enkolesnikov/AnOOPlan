/** Ограничения импорта: xlsx — самая тяжёлая зависимость, файл приходит извне. */
export const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
export const MAX_CATALOG_ROWS = 5000;

/** Читает первый лист XLSX/XLS/CSV в матрицу значений для импорта справочника. */
export async function readCatalogFile(file: File): Promise<unknown[][]> {
  if (file.size > MAX_CATALOG_BYTES) {
    throw new Error(`Файл справочника больше ${MAX_CATALOG_BYTES / 1024 / 1024} МБ — импорт отменён.`);
  }
  // xlsx тяжёлый: грузим отдельным чанком только при импорте таблицы.
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' }).slice(0, MAX_CATALOG_ROWS);
}
