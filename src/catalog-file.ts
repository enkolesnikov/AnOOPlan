/** Читает первый лист XLSX/XLS/CSV в матрицу значений для импорта справочника. */
export async function readCatalogFile(file: File): Promise<unknown[][]> {
  // xlsx тяжёлый: грузим отдельным чанком только при импорте таблицы.
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
}
