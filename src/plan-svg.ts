// SVG-снимок плана этажа: подложка накладывается отдельно растром, а трассы и оборудование
// рисуются векторами — этот снимок попадает в PDF «на подпись».
import type { Floor, Project } from './model';

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

  const equipment = project.equipment
    .filter(item => item.floorId === floor.id)
    .map(item => {
      const half = symbol / 2;
      return `<g>` +
        `<rect x="${round(item.x - half)}" y="${round(item.y - half)}" width="${round(symbol)}" height="${round(symbol)}" rx="${round(symbol / 6)}" fill="#122936" />` +
        `<text x="${round(item.x + half + 4)}" y="${round(item.y + symbol / 3)}" font-size="${round(symbol * 0.72)}" fill="#122936" font-family="sans-serif">${escapeXml(item.number)}</text>` +
        `</g>`;
    });

  const captionHeight = Math.max(24, height / 24);
  const caption = `<text x="${round(width / 2)}" y="${round(height - captionHeight / 2)}" font-size="${round(captionHeight * 0.55)}" ` +
    `text-anchor="middle" fill="#64767f" font-family="sans-serif">${escapeXml(`AnOOPlan · ${floor.name}`)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    `<rect width="100%" height="100%" fill="#ffffff" />` +
    segments.join('') +
    risers.join('') +
    equipment.join('') +
    caption +
    `</svg>`;
}
