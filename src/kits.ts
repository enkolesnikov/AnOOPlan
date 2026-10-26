import type { Equipment, Floor, Project } from './model';
import { createUuid as uid } from './compat';

export interface KitItem {
  type: string;
  name: string;
  /** Префикс обозначения: Ш1, К1, Р1, С1. */
  prefix: string;
  dx: number;
  dy: number;
  height: number;
  color?: string;
}

export interface EquipmentKit {
  id: string;
  name: string;
  description: string;
  items: KitItem[];
}

/** Типовые наборы оборудования: вставляются одним действием с сохранением взаимного расположения. */
export const EQUIPMENT_KITS: EquipmentKit[] = [
  {
    id: 'security', name: 'Пост охраны', description: 'Шкаф, камера и розетка на посту.',
    items: [
      { type: 'Шкаф', name: 'Шкаф поста охраны', prefix: 'Ш', dx: -120, dy: 0, height: 0, color: '#8b5cf6' },
      { type: 'Камера', name: 'Камера поста', prefix: 'К', dx: 0, dy: 0, height: 3, color: '#0ea5a4' },
      { type: 'Розетка', name: 'Розетка поста', prefix: 'Р', dx: 100, dy: 40, height: 0.3, color: '#e59a3a' },
    ],
  },
  {
    id: 'server', name: 'Серверная', description: 'Шкаф и коммутатор — узел сети.',
    items: [
      { type: 'Шкаф', name: 'Серверный шкаф', prefix: 'Ш', dx: -80, dy: 0, height: 0, color: '#8b5cf6' },
      { type: 'Коммутатор', name: 'Коммутатор', prefix: 'КМ', dx: 40, dy: 0, height: 0, color: '#2563eb' },
    ],
  },
  {
    id: 'checkpoint', name: 'Проходная', description: 'Считыватель, камера и розетка.',
    items: [
      { type: 'Считыватель', name: 'Считыватель проходной', prefix: 'С', dx: -80, dy: 0, height: 1.4, color: '#db2777' },
      { type: 'Камера', name: 'Камера проходной', prefix: 'К', dx: 40, dy: -30, height: 3, color: '#0ea5a4' },
      { type: 'Розетка', name: 'Розетка проходной', prefix: 'Р', dx: 90, dy: 50, height: 0.3, color: '#e59a3a' },
    ],
  },
];

/** Следующее свободное обозначение с числовым суффиксом. */
export function nextKitNumber(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

/** Свободная точка рядом с центром: комплект не должен вставать поверх существующего оборудования. */
function freeAnchor(project: Project, floor: Floor, start: { x: number; y: number }): { x: number; y: number } {
  const existing = project.equipment.filter(item => item.floorId === floor.id);
  const margin = 60;
  for (let radius = 0; radius <= 360; radius += 90) {
    const candidates = radius === 0 ? [[0, 0]] : [[radius, 0], [0, radius], [radius, radius], [-radius, 0], [0, -radius], [-radius, radius], [radius, -radius], [-radius, -radius]];
    for (const [dx, dy] of candidates) {
      const x = Math.min(Math.max(start.x + dx, margin), floor.width - margin);
      const y = Math.min(Math.max(start.y + dy, margin), floor.height - margin);
      if (!existing.some(item => Math.hypot(item.x - x, item.y - y) < 100)) return { x, y };
    }
  }
  return start;
}

/** Оборудование комплекта вокруг свободной точки этажа (или заданной точки). */
export function kitEquipment(kit: EquipmentKit, project: Project, floor: Floor, anchor?: { x: number; y: number }): Equipment[] {
  const used = new Set(project.equipment.map(item => item.number));
  const point = freeAnchor(project, floor, anchor ?? { x: floor.width / 2, y: floor.height / 2 });
  const x = point.x;
  const y = point.y;
  return kit.items.map(item => {
    const number = nextKitNumber(item.prefix, used);
    used.add(number);
    return {
      id: uid(), number, name: item.name, type: item.type, floorId: floor.id,
      x: x + item.dx, y: y + item.dy, height: item.height, note: '',
      properties: {}, photos: [], color: item.color ?? null,
    };
  });
}
