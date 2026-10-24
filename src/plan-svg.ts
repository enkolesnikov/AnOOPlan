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
      return `<g data-icon="${icon}" transform="translate(${round(item.x - half)}, ${round(item.y - half)}) scale(${scale})">` +
        `<rect x="1" y="1" width="22" height="22" rx="5" fill="#fff" stroke="${color}" stroke-width="2" />` +
        paths +
        `</g>` +
        `<text x="${round(item.x + half + 4)}" y="${round(item.y + iconSize / 3)}" font-size="${round(symbol * 0.72)}" fill="#122936" font-family="sans-serif">${escapeXml(item.number)}</text>`;
    });

  const captionHeight = Math.max(24, height / 24);
  const caption = `<text x="${round(width / 2)}" y="${round(height - captionHeight / 2)}" font-size="${round(captionHeight * 0.55)}" ` +
    `text-anchor="middle" fill="#64767f" font-family="sans-serif">${escapeXml(`AnOOPlan · ${floor.name}`)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    segments.join('') +
    risers.join('') +
    dimensions.join('') +
    equipment.join('') +
    caption +
    `</svg>`;
}
