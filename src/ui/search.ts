/**
 * Поиск по объектам проекта: регистронезависимый, по нескольким полям,
 * каждый токен запроса должен встретиться хотя бы в одном поле.
 */

/** Нормализует запрос: нижний регистр, разбиение по пробелам. */
export function normalizeQuery(query: string): string[] {
  return query.toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
}

/** true, если все токены запроса есть в склеенных полях; пустой запрос совпадает со всем. */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const tokens = normalizeQuery(query);
  if (tokens.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === 'string')
    .join(' ')
    .toLocaleLowerCase('ru-RU');
  return tokens.every(token => haystack.includes(token));
}

/** Подпись результата поиска для списка. */
export function searchCaption(query: string, found: number, total: number): string {
  if (query.trim() === '') return '';
  return `Найдено: ${found} из ${total}`;
}
