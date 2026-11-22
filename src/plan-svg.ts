// SVG-снимок плана этажа: это прозрачный оверлей. Подложка (белый лист + PDF) рисуется
// отдельно растром, а трассы и оборудование — векторами; снимок попадает в PDF «на подпись».
import type { Floor, Project } from './model';
import { EQUIPMENT_ICON_GLYPHS, equipmentColor, equipmentIcon } from './equipment-icons';
import { routeColor } from './route-kinds';
import { dimensionGeometry, dimensionText } from './engine';

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, character => {
  switch (character) {
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '&': return '&amp;';
    case '"': return '&quot;';
    default: return '&apos;';
  }
});

const round = (value: number): number => Math.round(value * 10) / 10;

/** Оценка ширины подписи: в sans-serif кириллица занимает около 0.62em на знак. */
const estimateTextWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.62;

interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle';
}

/**
 * Подпись символа на плане: справа от бейджа с просветом не меньше 20 % его
 * размера, если справа хватает места, иначе — под бейджем. У края листа подпись
 * прижимается внутрь, чтобы не выходить за рамку.
 */
function placeLabel(
  cx: number,
  cy: number,
  half: number,
  fontSize: number,
  text: string,
  sheetWidth: number,
  sheetHeight: number,
): LabelPlacement {
  // 25 % диаметра: 20 % — минимум по требованиям, но вплотную номер всё ещё
  // сливается с обводкой бейджа на печати в уменьшенном масштабе.
  const gap = Math.max(4, half * 0.5);
  const width = estimateTextWidth(text, fontSize);
  const margin = Math.max(2, fontSize * 0.25);
  const right = cx + half + gap;
  if (right + width <= sheetWidth - margin) {
    return { x: right, y: cy + fontSize * 0.35, anchor: 'start' };
  }
  // Справа места нет — под бейджем по центру; x прижимаем к рамке листа.
  const below = cy + half + gap + fontSize;
  const x = Math.min(Math.max(cx, width / 2 + margin), Math.max(width / 2 + margin, sheetWidth - width / 2 - margin));
  return { x, y: Math.min(below, Math.max(margin, sheetHeight - margin)), anchor: 'middle' };
}

/** Текст подписи с белой обводкой: на плотном плане без неё номер не читается. */
function labelText(placement: LabelPlacement, fontSize: number, fill: string, text: string): string {
  return `<text x="${round(placement.x)}" y="${round(placement.y)}" font-size="${round(fontSize)}" fill="${fill}" ` +
    `stroke="#fff" stroke-width="${round(Math.max(2, fontSize * 0.28))}" paint-order="stroke" ` +
    `font-family="sans-serif" text-anchor="${placement.anchor}" data-label="${escapeXml(text)}">${escapeXml(text)}</text>`;
}

export function buildPlanSvg(project: Project, floor: Floor): string {
  const width = Math.max(1, floor.width);
  const height = Math.max(1, floor.height);
  const routeWidth = Math.max(2, width / 420);
  const casingWidth = Math.max(5, width / 160);
  const symbol = Math.max(12, width / 70);

  const segments: string[] = [];
  const risers: string[] = [];
  for (const route of project.routes) {
    for (const segment of route.segments) {
      const onFloorA = segment.a.floorId === floor.id;
      const onFloorB = segment.b.floorId === floor.id;
      if (!onFloorA && !onFloorB) continue;
      const color = routeColor(route);
      if (onFloorA && onFloorB) {
        segments.push(
          `<line x1="${round(segment.a.x)}" y1="${round(segment.a.y)}" x2="${round(segment.b.x)}" y2="${round(segment.b.y)}" ` +
          `stroke="${color}" stroke-width="${round(routeWidth)}" stroke-linecap="round" />`,
        );
      } else {
        const vertex = onFloorA ? segment.a : segment.b;
        risers.push(
          `<circle cx="${round(vertex.x)}" cy="${round(vertex.y)}" r="${round(casingWidth)}" fill="none" stroke="${color}" stroke-width="${round(routeWidth / 2)}" />` +
          `<text x="${round(vertex.x + casingWidth)}" y="${round(vertex.y - casingWidth / 2)}" font-size="${round(symbol * 0.7)}" fill="${color}" font-family="sans-serif">↕</text>`,
        );
      }
    }
  }

  // Относительные размеры: расстояние по прямой между оборудованием, не по трассе.
  const dimensions = (project.dimensions ?? []).map(dimension => {
    const geometry = dimensionGeometry(project, dimension);
    const from = project.equipment.find(item => item.id === dimension.fromId);
    const to = project.equipment.find(item => item.id === dimension.toId);
    if (geometry.floorId !== floor.id || geometry.units === null || !from || !to) return '';
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const normalX = -Math.sin(angle) * 16;
    const normalY = Math.cos(angle) * 16;
    const x1 = from.x + normalX;
    const y1 = from.y + normalY;
    const x2 = to.x + normalX;
    const y2 = to.y + normalY;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return `<g stroke="#875ec5" stroke-width="${round(Math.max(1, width / 1000))}" fill="none">` +
      `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(x1)}" y2="${round(y1)}" stroke-dasharray="2 2" />` +
      `<line x1="${round(to.x)}" y1="${round(to.y)}" x2="${round(x2)}" y2="${round(y2)}" stroke-dasharray="2 2" />` +
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" />` +
      `<line x1="${round(x1 - normalX / 2)}" y1="${round(y1 - normalY / 2)}" x2="${round(x1 + normalX / 2)}" y2="${round(y1 + normalY / 2)}" />` +
      `<line x1="${round(x2 - normalX / 2)}" y1="${round(y2 - normalY / 2)}" x2="${round(x2 + normalX / 2)}" y2="${round(y2 + normalY / 2)}" />` +
      `</g><text x="${round(midX)}" y="${round(midY - 4)}" font-size="${round(symbol * 0.85)}" fill="#875ec5" stroke="#fff" stroke-width="${round(symbol * 0.16)}" paint-order="stroke" font-family="sans-serif" text-anchor="middle">${escapeXml(dimensionText(geometry))}</text>`;
  });

  // Оборудование — те же иконки, что и на экране: белый бейдж с обводкой цвета типа
  // и глиф заливкой; бейдж маленький, чтобы оверлей оставался прозрачным.
  const iconSize = Math.max(12, width / 70) * 1.4;
  const labelSize = symbol * 0.72;
  const equipment = project.equipment
    .filter(item => item.floorId === floor.id)
    .map(item => {
      const icon = equipmentIcon(item.type);
      const color = equipmentColor(item);
      const half = iconSize / 2;
      const scale = Math.round((iconSize / 24) * 1000) / 1000;
      const paths = EQUIPMENT_ICON_GLYPHS[icon].paths
        .map(path => `<path d="${path}" fill="${color}" fill-rule="evenodd" />`)
        .join('');
      const placement = placeLabel(item.x, item.y, half, labelSize, item.number, width, height);
      return `<g data-icon="${icon}" transform="translate(${round(item.x - half)}, ${round(item.y - half)}) scale(${scale})">` +
        `<rect x="1" y="1" width="22" height="22" rx="5" fill="#fff" stroke="${color}" stroke-width="2" />` +
        paths +
        `</g>` +
        labelText(placement, labelSize, '#122936', item.number);
    });

  // Пины-замечания: открытые — заметное оранжевое кольцо с точкой, закрытые —
  // серое кольцо с галочкой. Номер подписан рядом с белой обводкой, иначе
  // на плотном плане его не видно. Размеры масштабируются вместе с листом.
  const pinRadius = Math.max(6, width / 90);
  const pinStroke = Math.max(2, width / 480);
  const pinFont = Math.max(9, symbol * 0.7);
  const pins = (project.pins ?? [])
    .filter(pin => pin.floorId === floor.id)
    .map(pin => {
      const open = pin.status !== 'closed';
      const color = open ? '#e07b00' : '#88949a';
      const ring =
        `<circle data-pin="${escapeXml(pin.number)}" data-status="${pin.status}" cx="${round(pin.x)}" cy="${round(pin.y)}" ` +
        `r="${round(pinRadius)}" fill="#fff" stroke="${color}" stroke-width="${round(pinStroke)}" />`;
      const mark = open
        ? `<circle cx="${round(pin.x)}" cy="${round(pin.y)}" r="${round(pinRadius * 0.32)}" fill="${color}" />`
        : `<path d="M ${round(pin.x - pinRadius * 0.45)} ${round(pin.y + pinRadius * 0.02)} ` +
          `L ${round(pin.x - pinRadius * 0.12)} ${round(pin.y + pinRadius * 0.36)} ` +
          `L ${round(pin.x + pinRadius * 0.48)} ${round(pin.y - pinRadius * 0.34)}" ` +
          `fill="none" stroke="${color}" stroke-width="${round(pinStroke * 1.4)}" stroke-linecap="round" stroke-linejoin="round" />`;
      const placement = placeLabel(pin.x, pin.y, pinRadius, pinFont, pin.number, width, height);
      return ring + mark + labelText(placement, pinFont, open ? '#a35a00' : '#5f6f77', pin.number);
    });

  const captionHeight = Math.max(24, height / 24);
  const caption = `<text x="${round(width / 2)}" y="${round(height - captionHeight / 2)}" font-size="${round(captionHeight * 0.55)}" ` +
    `text-anchor="middle" fill="#64767f" font-family="sans-serif">${escapeXml(`AnOOPlan · ${floor.name}`)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    segments.join('') +
    risers.join('') +
    dimensions.join('') +
    equipment.join('') +
    pins.join('') +
    caption +
    `</svg>`;
}
