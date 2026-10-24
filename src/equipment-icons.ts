// Иконки оборудования одного набора для всех мест отрисовки:
// план в интерфейсе (SVG в App.tsx), снимок плана в PDF (plan-svg.ts) и список объектов.
// Геометрия задана в системе 24×24; цвет — только заливка (fill-rule="evenodd"), без обводок,
// чтобы одинаково выглядеть на светлой подложке PDF и на экране.

export type EquipmentIconId = 'camera' | 'cabinet' | 'socket' | 'switch' | 'reader' | 'generic';

export interface EquipmentIconGlyph {
  /** Контуры заливки в системе 24×24; дырки вырезаются правилом evenodd. */
  paths: string[];
}

export const EQUIPMENT_ICON_LABELS: Record<EquipmentIconId, string> = {
  camera: 'Камера',
  cabinet: 'Шкаф',
  socket: 'Розетка',
  switch: 'Коммутатор',
  reader: 'Считыватель',
  generic: 'Оборудование',
};

export const EQUIPMENT_ICON_GLYPHS: Record<EquipmentIconId, EquipmentIconGlyph> = {
  // Камера: корпус с верхним выступом, объектив — сквозное отверстие и точка в центре.
  camera: {
    paths: [
      'M9 5h6v2h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V5zM12 8.4a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
      'M12 10.1a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z',
    ],
  },
  // Шкаф: корпус с дверцей-окном и ручкой.
  cabinet: {
    paths: [
      'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9.5 5.2v13.6h5V5.2h-5z',
      'M13.2 11.2h1v1.6h-1z',
    ],
  },
  // Розетка: кольцо с двумя вертикальными гнёздами и заземлением.
  socket: {
    paths: [
      'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 2.3a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4z',
      'M9.1 7.6h1.7v6.2H9.1zM13.2 7.6h1.7v6.2h-1.7zM11.2 16.4h1.6v1.1h-1.6z',
    ],
  },
  // Коммутатор: корпус с тремя портами.
  switch: {
    paths: [
      'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm1.5 6h2.6v2.6H6.5zM10.7 12h2.6v2.6h-2.6zM14.9 12h2.6v2.6h-2.6z',
    ],
  },
  // Считыватель: корпус с индикатором и площадкой для карты.
  reader: {
    paths: [
      'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.2 3.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM9.4 14.6h5.2v3.2H9.4z',
    ],
  },
  // Универсальное оборудование: прежний маркер «квадрат с плюсом», но плюс — сквозной.
  generic: {
    paths: [
      'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm4.6 5v2.4H8.2v3.2h2.4V16h3.2v-2.4h2.4V10.6h-2.4V8h-3.2z',
    ],
  },
};

/** Пресеты палитры для выбора цвета иконки в свойствах оборудования. */
export const EQUIPMENT_COLOR_PRESETS = [
  '#122936',
  '#008e94',
  '#875ec5',
  '#e78c22',
  '#2f9e63',
  '#dc5071',
  '#3f6ad8',
  '#64767f',
] as const;

/** Цвета по умолчанию: разные типы оборудования сразу различимы на плане. */
export const EQUIPMENT_ICON_DEFAULT_COLORS: Record<EquipmentIconId, string> = {
  camera: '#122936',
  cabinet: '#875ec5',
  socket: '#e78c22',
  switch: '#008e94',
  reader: '#3f6ad8',
  generic: '#122936',
};

/** Иконка по типу оборудования; регистр и свободный текст в типе не мешают. */
export function equipmentIcon(type: string): EquipmentIconId {
  const value = String(type ?? '').toLowerCase();
  if (value.includes('камер')) return 'camera';
  if (value.includes('шкаф')) return 'cabinet';
  if (value.includes('розет')) return 'socket';
  if (value.includes('коммутатор')) return 'switch';
  if (value.includes('считыв')) return 'reader';
  return 'generic';
}

/** #rgb → #rrggbb, проверка формата; неверный цвет → null (значение не подменяется «по умолчанию» молча). */
export function normalizeEquipmentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text.slice(1).replace(/./g, character => character + character)}`;
  return null;
}

/** Итоговый цвет иконки: сохранённый валидный цвет или цвет по умолчанию для её типа. */
export function equipmentColor(item: { type: string; color?: string | null }): string {
  return normalizeEquipmentColor(item.color) ?? EQUIPMENT_ICON_DEFAULT_COLORS[equipmentIcon(item.type)];
}

/** Человекочитаемое имя иконки для свойств и списка объектов. */
export function equipmentIconLabel(type: string): string {
  return EQUIPMENT_ICON_LABELS[equipmentIcon(type)];
}
