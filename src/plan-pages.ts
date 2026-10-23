/** Защита от сотен страниц: каждая страница — отдельный PNG в PDF. */
export const MAX_PLAN_PAGES = 12;

/** Название листа: для одностраничного этажа — имя этажа, для многостраничного — с номером. */
export function planPageTitle(floorName: string, page: number, pageCount: number): string {
  return pageCount > 1 ? `${floorName} · лист ${page}` : floorName;
}

/** Сколько страниц PDF реально выгружать с учётом лимита. */
export function planPagesToCapture(pageCount: number): number {
  return Math.max(0, Math.min(Math.floor(pageCount), MAX_PLAN_PAGES));
}
