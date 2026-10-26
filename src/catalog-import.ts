import type { PriceItem, PriceKind } from './model';
import { createUuid as uid } from './compat';

/** Результат разбора таблицы: позиции, ошибки построчно и распознанные колонки. */
export interface CatalogImportResult {
  items: PriceItem[];
  errors: string[];
  headers: string[];
  columns: Partial<Record<'kind' | 'name' | 'article' | 'manufacturer' | 'series' | 'size' | 'unit' | 'price' | 'note', number>>;
}

const COLUMN_ALIASES: Record<keyof CatalogImportResult['columns'], string[]> = {
  kind: ['вид', 'вид позиции', 'тип', 'категория', 'kind', 'type'],
  name: ['наименование', 'название', 'модель', 'марка', 'name', 'model'],
  article: ['артикул', 'код', 'article', 'sku'],
  manufacturer: ['производитель', 'бренд', 'manufacturer', 'brand'],
  series: ['серия', 'series'],
  size: ['размер', 'типоразмер', 'сечение', 'size'],
  unit: ['ед', 'ед.', 'единица', 'единица измерения', 'unit', 'uom'],
  price: ['цена', 'цена, ₽', 'цена руб', 'стоимость', 'price'],
  note: ['примечание', 'комментарий', 'note', 'comment'],
};

const KIND_ALIASES: Record<string, PriceKind> = {
  оборудование: 'equipment', оборуд: 'equipment', шкаф: 'equipment', камера: 'equipment', розетка: 'equipment',
  оборудование_сети: 'equipment', equipment: 'equipment',
  кабель: 'cable', провод: 'cable', cable: 'cable',
  кнс: 'tray', лоток: 'tray', гофра: 'tray', труба: 'tray', 'кабель-канал': 'tray', кабельный_лоток: 'tray',
  tray: 'tray', trunking: 'tray', pipe: 'tray',
};

const DEFAULT_UNITS: Record<PriceKind, string> = { equipment: 'шт', cable: 'м', tray: 'м' };

const text = (value: unknown): string => value === null || value === undefined ? '' : String(value).trim();
const normalizeHeader = (value: string): string => text(value).toLowerCase().replace(/ё/g, 'е').replace(/[.,]/g, '').replace(/\s+/g, ' ');

/** Разбирает «12 500,50 ₽» в 12500.5; пустое значение даёт null; мусор — NaN. */
export function parsePriceCell(value: unknown): number | null {
  const raw = text(value).replace(/\s|\u00a0/g, '').replace(/[₽руб.]/gi, '').replace(',', '.');
  if (raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : NaN;
}

/** Вид позиции: русские/английские синонимы, по умолчанию — оборудование. */
export function parseKindCell(value: unknown): PriceKind {
  const key = normalizeHeader(text(value)).replace(/\s+/g, '_');
  return KIND_ALIASES[key] ?? (key.includes('кабел') && !key.includes('канал') ? 'cable' : key.includes('лот') || key.includes('гофр') || key.includes('труб') || key.includes('кнс') ? 'tray' : 'equipment');
}

/** Разбирает строки (первая непустая — заголовки) в позиции справочника с отчётом об ошибках. */
export function parseCatalogRows(rows: unknown[][]): CatalogImportResult {
  const errors: string[] = [];
  const headers: string[] = [];
  let headerIndex = -1;
  let columns: CatalogImportResult['columns'] = {};
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const headerCells = row.map(text);
    const found: CatalogImportResult['columns'] = {};
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[keyof CatalogImportResult['columns'], string[]]>) {
      const column = headerCells.findIndex(cell => aliases.includes(normalizeHeader(cell)));
      if (column >= 0) found[field] = column;
    }
    if (found.name !== undefined) {
      headerIndex = index; columns = found; headers.push(...headerCells); break;
    }
  }
  if (headerIndex < 0) {
    return { items: [], errors: ['Не найдена колонка «Наименование»: проверьте заголовки таблицы.'], headers, columns: {} };
  }
  const cell = (row: unknown[], field: keyof CatalogImportResult['columns']): string => {
    const column = columns[field];
    return column === undefined ? '' : text(row[column]);
  };
  const items: PriceItem[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (!row.some(value => text(value) !== '')) continue;
    const rowNumber = index + 1;
    const name = cell(row, 'name');
    if (!name) { errors.push(`Строка ${rowNumber}: не указано наименование — пропущена.`); continue; }
    const kind = parseKindCell(cell(row, 'kind'));
    const price = parsePriceCell(cell(row, 'price'));
    if (Number.isNaN(price)) errors.push(`Строка ${rowNumber}: цена «${cell(row, 'price')}» не число — будет пустой.`);
    const item: PriceItem = {
      id: uid(), kind, name,
      article: cell(row, 'article'),
      manufacturer: cell(row, 'manufacturer'),
      series: cell(row, 'series'),
      size: cell(row, 'size'),
      unit: cell(row, 'unit') || DEFAULT_UNITS[kind],
      price: Number.isNaN(price) ? null : price,
      note: cell(row, 'note'),
    };
    items.push(item);
  }
  if (!items.length && !errors.length) errors.push('В таблице нет строк с данными.');
  return { items, errors, headers, columns };
}

/** Обновляет существующие позиции по виду и наименованию, новые добавляет. */
export function mergeCatalog(existing: PriceItem[], incoming: PriceItem[]): { catalog: PriceItem[]; added: number; updated: number } {
  const catalog = [...existing];
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const key = `${item.kind}:${item.name.trim().toLowerCase()}`;
    const index = catalog.findIndex(entry => `${entry.kind}:${entry.name.trim().toLowerCase()}` === key);
    if (index < 0) { catalog.push(item); added += 1; continue; }
    const previous = catalog[index];
    const next: PriceItem = { ...previous };
    for (const field of ['article', 'manufacturer', 'series', 'size', 'unit', 'note'] as const) {
      if (item[field]) next[field] = item[field];
    }
    if (item.price !== null) next.price = item.price;
    catalog[index] = next;
    updated += 1;
  }
  return { catalog, added, updated };
}
