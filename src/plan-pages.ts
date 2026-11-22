import type { Floor, Project } from './model';

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

/**
 * Почему оверлей этажа не попал на лист (или null, если всё в порядке):
 * выбранная страница может отсутствовать в PDF или не попасть в лимит выгрузки.
 */
export function planOverlayWarning(floorName: string, floorPage: number, pageCount: number, capturedPages: number): string | null {
  if (floorPage < 1 || floorPage > pageCount) {
    return `Этаж «${floorName}»: выбранная страница ${floorPage} вне диапазона, оверлей не нанесён.`;
  }
  if (floorPage > capturedPages) {
    return `Этаж «${floorName}»: страница ${floorPage} не выгружена из-за лимита ${MAX_PLAN_PAGES}; оверлей не нанесён.`;
  }
  return null;
}

/**
 * Этажи, для которых нужен лист плана: есть оборудование, вершина трассы
 * или пин-замечание на этаже. Порядок — как в `project.floors`.
 */
export function planFloors(project: Project): Floor[] {
  const equipmentFloors = new Set(project.equipment.map(item => item.floorId));
  const routeFloors = new Set<string>();
  for (const route of project.routes) {
    for (const segment of route.segments) {
      routeFloors.add(segment.a.floorId);
      routeFloors.add(segment.b.floorId);
    }
  }
  const pinFloors = new Set((project.pins ?? []).map(pin => pin.floorId));
  return project.floors.filter(floor =>
    equipmentFloors.has(floor.id) || routeFloors.has(floor.id) || pinFloors.has(floor.id));
}

/** Один лист раздела «Планы»: страница PDF и этаж, чей оверлей на неё нанесён. */
export interface PlanSheet {
  /** Страница PDF (1…capturedPages). */
  page: number;
  /** Этаж, чей оверлей нанесён; null — общая подложка без оверлея. */
  floor: Floor | null;
  title: string;
  overlay: boolean;
  /** Пояснение на листе (почему не нанесён оверлей другого этажа). */
  note?: string;
}

export interface PlanLayout {
  sheets: PlanSheet[];
  warnings: string[];
  capturedPages: number;
}

/** Этажи с общим PDF; `pdfId: null` — этажи без подложки (белый лист и оверлей). */
export interface FloorPdfGroup {
  pdfId: string | null;
  floors: Floor[];
}

/** Группировка этажей по общему PDF. Порядок групп — по первому этажу в проекте. */
export function groupFloorsByPdf(floors: Floor[]): FloorPdfGroup[] {
  const groups = new Map<string | null, Floor[]>();
  for (const floor of floors) {
    const key = floor.pdfId && floor.pdfId.trim() ? floor.pdfId : null;
    const group = groups.get(key);
    if (group) group.push(floor);
    else groups.set(key, [floor]);
  }
  return [...groups].map(([pdfId, group]) => ({ pdfId, floors: group }));
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

/**
 * Раскладка листов для группы этажей с общим PDF: каждая страница PDF
 * печатается ровно один раз (1…min(pageCount, MAX_PLAN_PAGES)).
 *
 * Страницу, выбранную этажом, получает первый такой этаж в порядке проекта;
 * остальным — предупреждение. Незанятая страница печатается как общая подложка.
 * Для одного этажа с многостраничным PDF сохраняются прежние названия листов,
 * а для группы с общим PDF общая подложка называется «Подложка · лист N».
 */
export function planSheetsForPdf(floors: Floor[], pageCount: number): PlanLayout {
  const capturedPages = planPagesToCapture(pageCount);
  const warnings: string[] = [];

  if (pageCount > MAX_PLAN_PAGES) {
    const names = floors.map(floor => `«${floor.name}»`).join(', ');
    addWarning(warnings, names
      ? `${floors.length === 1 ? 'Этаж' : 'Этажи'} ${names}: показаны первые ${MAX_PLAN_PAGES} страниц из ${pageCount}.`
      : `Показаны первые ${MAX_PLAN_PAGES} страниц из ${pageCount}.`);
  }

  // Страницы, на которые претендуют этажи с корректным номером, в порядке проекта.
  const claims = new Map<number, Floor[]>();
  for (const floor of floors) {
    if (planOverlayWarning(floor.name, floor.page, pageCount, capturedPages)) continue;
    const claimants = claims.get(floor.page);
    if (claimants) claimants.push(floor);
    else claims.set(floor.page, [floor]);
  }

  // Пояснения на листах: чужая страница пишется на лист победителя,
  // а предупреждение о странице вне диапазона — на первый лист группы.
  const notes = new Map<number, string[]>();
  const addNote = (page: number, text: string): void => {
    const list = notes.get(page);
    if (list) list.push(text);
    else notes.set(page, [text]);
  };

  for (const floor of floors) {
    const outOfRange = planOverlayWarning(floor.name, floor.page, pageCount, capturedPages);
    if (outOfRange) {
      addWarning(warnings, outOfRange);
      if (capturedPages > 0) addNote(1, outOfRange);
      continue;
    }
    const claimants = claims.get(floor.page) ?? [];
    if (claimants[0] === floor) continue;
    const warning = `Этаж «${floor.name}»: страница ${floor.page} уже занята этажом «${claimants[0]?.name ?? ''}», оверлей не нанесён.`;
    addWarning(warnings, warning);
    addNote(floor.page, warning);
  }

  const soleFloor = floors.length === 1 ? floors[0] : null;
  const sheets: PlanSheet[] = [];
  for (let page = 1; page <= capturedPages; page += 1) {
    const claimant = claims.get(page)?.[0] ?? null;
    // Один этаж с многостраничным PDF: подложка называется его именем, как раньше.
    const title = claimant
      ? planPageTitle(claimant.name, page, pageCount)
      : soleFloor
        ? planPageTitle(soleFloor.name, page, pageCount)
        : `Подложка · лист ${page}`;
    const sheet: PlanSheet = { page, floor: claimant, title, overlay: claimant !== null };
    const sheetNotes = notes.get(page);
    if (sheetNotes?.length) sheet.note = sheetNotes.join(' ');
    sheets.push(sheet);
  }

  return { sheets, warnings, capturedPages };
}
