// SVG-снимок плана этажа: это прозрачный оверлей. Подложка (белый лист + PDF) рисуется
// отдельно растром, а трассы и оборудование — векторами; снимок попадает в PDF «на подпись».
import type { Floor, Project } from './model';
import { EQUIPMENT_ICON_GLYPHS, equipmentColor, equipmentIcon } from './equipment-icons';

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
      if (onFloorA && onFloorB) {
        segments.push(
          `<line x1="${round(segment.a.x)}" y1="${round(segment.a.y)}" x2="${round(segment.b.x)}" y2="${round(segment.b.y)}" ` +
          `stroke="#008e94" stroke-width="${round(routeWidth)}" stroke-linecap="round" />`,
        );
      } else {
        const vertex = onFloorA ? segment.a : segment.b;
        risers.push(
          `<circle cx="${round(vertex.x)}" cy="${round(vertex.y)}" r="${round(casingWidth)}" fill="none" stroke="#875ec5" stroke-width="${round(routeWidth / 2)}" />` +
          `<text x="${round(vertex.x + casingWidth)}" y="${round(vertex.y - casingWidth / 2)}" font-size="${round(symbol * 0.7)}" fill="#875ec5" font-family="sans-serif">↕</text>`,
        );
      }
    }
  }

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
    equipment.join('') +
    caption +
    `</svg>`;
}
