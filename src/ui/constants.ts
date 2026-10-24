import type { JournalSectionId } from '../export-pdf';

/** Радиус привязки к соседним объектам в пикселях экрана. */
export const SNAP_PX = 12;
/** Форматы листа: размеры в миллиметрах для альбомной и портретной ориентации. */
export const SHEET_SIZES: Record<string, { landscape: number; portrait: number }> = {
  A4: { landscape: 297, portrait: 210 },
  A3: { landscape: 420, portrait: 297 },
  A2: { landscape: 594, portrait: 420 },
  A1: { landscape: 841, portrait: 594 },
  A0: { landscape: 1189, portrait: 841 },
};
/** Максимальное расстояние от конца трассы до устройства, при котором концы привязываются. */
export const CABLE_SNAP_LIMIT = 100;
/** Разделы печатной формы: порядок и подписи чекбоксов «Печать выбранных разделов». */
export const JOURNAL_SECTIONS: { id: JournalSectionId; label: string }[] = [
  { id: 'journal', label: 'Журнал' },
  { id: 'equipment', label: 'Оборудование' },
  { id: 'cables', label: 'Кабели' },
  { id: 'infrastructure', label: 'Инфраструктура' },
  { id: 'trayFill', label: 'Заполнение лотков' },
  { id: 'estimate', label: 'Смета' },
  { id: 'commercial', label: 'Коммерческое предложение' },
  { id: 'pins', label: 'Замечания' },
  { id: 'warnings', label: 'Предупреждения' },
  { id: 'plans', label: 'Планы' },
  { id: 'photos', label: 'Фото оборудования' },
  { id: 'pinPhotos', label: 'Фото замечаний' },
  { id: 'changeLog', label: 'Лист изменений' },
];
