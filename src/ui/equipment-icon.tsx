import type { Equipment } from '../model';
import { EQUIPMENT_ICON_GLYPHS, equipmentColor, equipmentIcon } from '../equipment-icons';

/** Значок оборудования в системе 24×24: список объектов и превью в свойствах. */
export function EquipmentIcon({ item, size = 18, className }: { item: { type: string; color?: string | null }; size?: number; className?: string }) {
  const color = equipmentColor(item);
  const paths = EQUIPMENT_ICON_GLYPHS[equipmentIcon(item.type)].paths;
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x={1} y={1} width={22} height={22} rx={5} fill="#fff" stroke={color} strokeWidth={2} />
    {paths.map(d => <path key={d} d={d} fill={color} fillRule="evenodd" />)}
  </svg>;
}

/**
 * Маркер оборудования на плане. Размер задан в единицах плана как 26/zoom,
 * поэтому на экране иконка остаётся постоянной, а номер читается рядом.
 */
export function EquipmentSymbol({ item, zoom }: { item: Equipment; zoom: number }) {
  const size = 26 / zoom;
  const color = equipmentColor(item);
  const paths = EQUIPMENT_ICON_GLYPHS[equipmentIcon(item.type)].paths;
  return <>
    <circle r={20 / zoom} fill="transparent" />
    <g transform={`translate(${-size / 2},${-size / 2}) scale(${size / 24})`} pointerEvents="none">
      <rect className="equipment-badge" x={1} y={1} width={22} height={22} rx={5} fill="#fff" stroke={color} strokeWidth={2} />
      {paths.map(d => <path key={d} d={d} fill={color} fillRule="evenodd" />)}
    </g>
    <text x={size / 2 + 4 / zoom} y={4 / zoom} fontSize={12 / zoom} className="svg-label">{item.number}</text>
  </>;
}
