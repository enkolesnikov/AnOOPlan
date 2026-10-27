/** Локальный SVG-набор инструментов: одинаковые иконки на Android и desktop,
 * без внешних CDN и зависимости от системного emoji-шрифта. */
export type ToolIconName = 'select' | 'pan' | 'equipment' | 'route' | 'dimension' | 'cable' | 'calibrate' | 'measure' | 'pin' | 'more';

const STROKE: Record<Exclude<ToolIconName, 'select' | 'pin' | 'more'>, string[]> = {
  pan: ['M12 3v18', 'M3 12h18', 'M8 7l-4 5 4 5', 'M16 7l4 5-4 5', 'M7 8l5-4 5 4', 'M7 16l5 4 5-4'],
  equipment: ['M4 5h16v14H4z', 'M8 9h8v6H8z'],
  route: ['M4 17l5-6 4 4 7-9'],
  dimension: ['M3 12h18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4'],
  cable: ['M3 17c4 0 4-10 9-10s5 10 9 10', 'M3 17h2', 'M19 17h2'],
  calibrate: ['M3 8h18', 'M6 5v6', 'M18 5v6', 'M3 16h18', 'M6 13v6', 'M18 13v6'],
  measure: ['M3 17L17 3l4 4L7 21z', 'M8 15l2 2', 'M11 12l2 2', 'M14 9l2 2'],
};

export function ToolIcon({ name, size = 18 }: { name: ToolIconName; size?: number }) {
  if (name === 'select') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path d="M5 3l14 8-6.2 1.1L9.8 19z" fill="currentColor" /></svg>;
  if (name === 'pin') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" fill="currentColor" /></svg>;
  if (name === 'more') return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>;
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{STROKE[name].map(path => <path key={path} d={path} />)}</svg>;
}
