import { useEffect, useRef, useState, type RefObject } from 'react';
import { dimensionGeometry, dimensionText, findRoute } from '../engine';
import { createUuid } from '../compat';
import { equipmentColor, equipmentIcon } from '../equipment-icons';
import { routeColor } from '../route-kinds';
import { PlanAccessibilityList } from '../PlanAccessibilityList';
import { EquipmentSymbol } from './equipment-icon';
import { areaLabel, number } from './format';
import { equipmentSelect } from './selects';
import type { Tool } from './types';
import { ToolIcon } from './icons';
import type { AppUi } from './use-app-controller';

/** Подпись, иконка и подсказка инструмента: один источник для панели и шторки. */
const TOOL_META: Record<Tool, { icon: string; label: string; hint: string }> = {
  select: { icon: '↖', label: 'Выбор', hint: 'Выберите объект • тяните • двойной клик по сегменту — вершина' },
  pan: { icon: '✥', label: 'Панорама', hint: 'Перетаскивайте план • колесо — масштаб' },
  equipment: { icon: '▣', label: 'Оборудование', hint: 'Клик на плане — добавить оборудование' },
  route: { icon: '⌁', label: 'Трасса', hint: 'Клики — вершины • Enter — завершить • Esc — отменить' },
  dimension: { icon: '⟷', label: 'Размер', hint: 'Размер между оборудованием: выберите два объекта — расстояние по прямой' },
  cable: { icon: '↝', label: 'Кабель', hint: 'Выбирайте сегменты по порядку от начала к концу' },
  calibrate: { icon: '↔', label: 'Масштаб', hint: 'Укажите две точки известного размера на PDF' },
  measure: { icon: '📏', label: 'Рулетка', hint: 'Рулетка: две точки на плане → расстояние в метрах' },
  pin: { icon: '📍', label: 'Замечание', hint: 'Клик на плане — добавить замечание' },
};
/** Порядок кнопок на десктопе: восемь инструментов, как раньше. */
const DESKTOP_TOOLS: Tool[] = ['select', 'pan', 'equipment', 'route', 'dimension', 'cable', 'calibrate', 'measure'];
/** На узком экране остаются четыре частых инструмента, остальные — в шторке «Ещё». */
const MORE_TOOLS: Tool[] = ['cable', 'dimension', 'calibrate', 'measure', 'pin'];
const SECONDARY_TOOLS = new Set<Tool>(MORE_TOOLS);

/** Шторка «Ещё»: редкие инструменты плана с полными подписями и крупными целями. */
function ToolMoreSheet({ ui, returnFocus }: { ui: AppUi; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const {
    tool, setTool, setDraft, setCalibration, setMeasure, setToolsMoreOpen, grid, setGrid, snap, setSnap, ortho, setOrtho,
  } = ui;
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => setToolsMoreOpen(false));
  closeRef.current = () => setToolsMoreOpen(false);
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?? listRef.current?.querySelector<HTMLButtonElement>('button');
    active?.focus();
    // Escape закрывает только эту шторку и не сбрасывает активный инструмент.
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      returnFocusRef.current.current?.focus();
    };
  }, []);
  function pick(id: Tool) {
    setTool(id); setDraft([]); setCalibration([]); setMeasure([]); setToolsMoreOpen(false);
  }
  return (
    <div className="sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setToolsMoreOpen(false); }}>
      <section className="sheet tool-sheet" role="dialog" aria-modal="true" aria-label="Ещё инструменты">
        <div className="sheet-grip" />
        <div className="sheet-head"><strong>Ещё инструменты</strong><button aria-label="Закрыть" onClick={() => setToolsMoreOpen(false)}>×</button></div>
        <div className="sheet-list">
          <div className="tool-sheet-list" ref={listRef}>
            {MORE_TOOLS.map(id => {
              const meta = TOOL_META[id];
              return <button key={id} className={tool === id ? 'active' : ''} aria-pressed={tool === id} onClick={() => pick(id)}>
                <ToolIcon name={id} />
                <span className="tool-sheet-text"><strong>{meta.label}</strong><small>{meta.hint}</small></span>
              </button>;
            })}
          </div>
          <span className="section-label">Параметры плана</span>
          <div className="tool-sheet-options">
            <label className="print-section"><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />Сетка</label>
            <label className="print-section"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Привязка</label>
            <label className="print-section"><input type="checkbox" checked={ortho} onChange={event => setOrtho(event.target.checked)} />Ортогонально</label>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Экран плана: тулбар, сетка, SVG-оверлей, подсказки и панель доступности. */
export function PlanScreen({ ui }: { ui: AppUi }) {
  const {
    project, floor, tool, setTool, undo, redo, history, grid, setGrid, snap, setSnap, ortho, setOrtho,
    gridSize, setGridSize, pdfPages, floorId, mutate, fit, changeZoom, zoom, pan, canvas, renderPlan, undoLabel, redoLabel,
    draft, setDraft, routeHeight, setRouteHeight, finishRoute, measure, measureMode, setMeasureMode, setMeasure,
    calibration, setCalibration,
    setMessage, cableFrom, setCableFrom, cableTo, setCableTo, setCableSegments, cableSegments, finishCable,
    setError, pdfError, pdfNote, stage, pointerDown, pointerMove, pointerUp, pointerCancel, stagePressDown,
    moveLongPress, cancelLongPress, zoomAt, armTap, position, startDrag, pinching, selection, setSelection,
    setTab, setView, pointer, route, cable, setSheet, insertVertex, deleteVertex, snapMark, toolsMoreOpen, setToolsMoreOpen,
  } = ui;
  const [dimensionFrom, setDimensionFrom] = useState<string | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDimensionFrom(null); }, [tool]);
  function pickTool(id: Tool) {
    setTool(id); setDraft([]); setCalibration([]); setMeasure([]);
  }
  function measureLabel(): string {
    if (measureMode === 'area') return measure.length >= 3 ? areaLabel(measure, floor?.metersPerUnit) : '';
    if (measure.length < 2) return '';
    const units = Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y);
    const scale = floor?.metersPerUnit;
    return scale && scale > 0 ? `${number(units * scale)} м` : `${number(units)} ед.`;
  }
  return (
<div className="plan-view">
<div className="drawing-toolbar"><div className="tool-group tools-main">{DESKTOP_TOOLS.map(id => { const meta = TOOL_META[id]; const secondary = SECONDARY_TOOLS.has(id); return <button key={id} title={meta.label} aria-pressed={tool === id} className={`${tool === id ? 'active' : ''} ${secondary ? 'tool-secondary' : ''}`.trim()} onClick={() => pickTool(id)}><ToolIcon name={id} /><span>{meta.label}</span></button>; })}<button ref={moreButtonRef} type="button" className={`tool-more-button${SECONDARY_TOOLS.has(tool) ? ' has-active' : ''}`} title="Ещё инструменты: Кабель, Размер, Масштаб, Рулетка, Замечание" aria-haspopup="dialog" aria-expanded={toolsMoreOpen} aria-label={SECONDARY_TOOLS.has(tool) ? `Ещё инструменты, активен: ${TOOL_META[tool].label}` : 'Ещё инструменты'} onClick={() => setToolsMoreOpen(true)}><ToolIcon name="more" /><span>Ещё</span></button></div><div className="tool-group history"><button title={undoLabel ? `Отменить: ${undoLabel} (Ctrl+Z)` : "Отменить Ctrl+Z"} aria-label="Отменить" disabled={!undo.length} onClick={() => history(true)}>↶</button><button title={redoLabel ? `Повторить: ${redoLabel} (Ctrl+Shift+Z)` : "Повторить Ctrl+Shift+Z"} aria-label="Повторить" disabled={!redo.length} onClick={() => history(false)}>↷</button></div></div>      <div className="drawing-options"><label><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />Сетка</label><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Привязка</label><label><input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} />Ортогонально</label><label>Шаг<input className="mini-input" type="number" min="1" value={gridSize} onChange={e => setGridSize(Math.max(1, Number(e.target.value) || 1))} /></label><span className="grow" />{floor?.pdfId && <label>Страница <input className="mini-input" type="number" min="1" max={pdfPages || 9999} value={floor.page} onChange={e => { const page = Math.max(1, Math.min(pdfPages || 9999, Number(e.target.value) || 1)); if (page !== floor.page && window.confirm('Смена страницы сохраняет объекты и сбрасывает масштаб. Продолжить?')) mutate(p => { const f = p.floors.find(f => f.id === floor.id)!; f.page = page; f.metersPerUnit = null; }); }} /> / {pdfPages || '…'}</label>}<button onClick={fit} aria-label="Вписать план">Вписать</button><button onClick={() => changeZoom(zoom / 1.2)} aria-label="Уменьшить масштаб">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => changeZoom(zoom * 1.2)} aria-label="Увеличить масштаб">＋</button><button className={tool === 'pin' ? 'active' : ''} title="Замечание" onClick={() => setTool(tool === 'pin' ? 'select' : 'pin')}><ToolIcon name="pin" /> Замечание</button></div>
      {tool === 'route' && <div className="contextbar"><span>Трасса: {draft.length} вершин</span><label>Высота, м <input type="text" inputMode="decimal" value={routeHeight} onChange={e => setRouteHeight(e.target.value.replace(',', '.'))} /></label><button className="primary" disabled={draft.length < 2} onClick={finishRoute}>Завершить · Enter</button><button onClick={() => setDraft([])}>Сбросить</button></div>}
      {tool === 'dimension' && <div className="contextbar"><span>{dimensionFrom ? `Размер: ${project.equipment.find(item => item.id === dimensionFrom)?.number ?? '?'} → выберите второе оборудование` : 'Размер между оборудованием: выберите первое'}</span><button onClick={() => setDimensionFrom(null)}>Сброс</button><small>{floor?.metersPerUnit ? 'Расстояние по прямой, в метрах.' : 'Масштаб не задан — расстояние в единицах PDF.'}</small></div>}
      {tool === 'measure' && <div className="contextbar"><span>{measureMode === 'length' ? `Рулетка: точек ${Math.min(measure.length, 2)} из 2` : `Площадь: вершин ${measure.length}`}</span><button className={measureMode === 'length' ? 'primary' : ''} onClick={() => { setMeasureMode('length'); setMeasure([]); setMessage('Рулетка: укажите две точки на плане.'); }}>Длина</button><button className={measureMode === 'area' ? 'primary' : ''} onClick={() => { setMeasureMode('area'); setMeasure([]); setMessage('Площадь: обведите контур по вершинам, минимум три.'); }}>Площадь</button><button onClick={() => setMeasure([])}>Сброс</button><small>{floor?.metersPerUnit ? 'Метры по масштабу листа.' : 'Масштаб не задан — результат в единицах PDF.'}</small></div>}
      {tool === 'cable' && <div className="contextbar cable-builder"><label>От {equipmentSelect(project, cableFrom, setCableFrom)}</label><span>→</span><label>До {equipmentSelect(project, cableTo, setCableTo)}</label><button onClick={() => { if (!cableFrom || !cableTo) { setError('Сначала выберите «От» и «До».'); return; } const res = findRoute(project, cableFrom, cableTo); if (res.error) setError(res.error); else { setCableSegments(res.segmentIds); setMessage(`Маршрут построен: ${res.segmentIds.length} сегм.`); } }}>Автомаршрут</button><span>{cableSegments.length} сегм.</span><button className="primary" onClick={finishCable}>Создать</button><button onClick={() => setCableSegments([])}>Сброс</button><small>Выберите «От» и «До» — маршрут строится сам. Можно скорректировать сегменты кликами.</small></div>}
      {pdfError && <div className="banner error">{pdfError}</div>}
      {pdfNote && <div className="banner" role="status" aria-live="polite">{pdfNote}</div>}
      <div className={`drawing-stage tool-${tool}`} ref={stage}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}
        onPointerDownCapture={stagePressDown} onPointerMoveCapture={moveLongPress} onPointerUpCapture={cancelLongPress}
        onWheel={e => { e.preventDefault(); changeZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }}
        onContextMenu={event => {
          const element = (event.target as Element).closest('[data-object]');
          if (!element) return;
          const kind = element.getAttribute('data-object');
          const id = kind === 'segment' ? element.getAttribute('data-route') : element.getAttribute('data-id');
          if (!id || (kind !== 'equipment' && kind !== 'pin' && kind !== 'segment')) return;
          event.preventDefault();
          setSheet({ kind: kind === 'segment' ? 'route' : kind, id });
        }}
        onDoubleClick={e => { if ((e.target as Element).closest('[data-object]')) return; e.preventDefault(); if (zoom < 1.5) zoomAt(e.clientX, e.clientY, zoom * 2.4); else fit(); }}>
        {floor && <div className="drawing-sheet" style={{ width: floor.width, height: floor.height, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          {floor.pdfId ? <canvas ref={canvas} aria-label={`План: ${floor?.name ?? 'этаж'}`} style={renderPlan ? { position: 'absolute', left: renderPlan.clipX, top: renderPlan.clipY, width: renderPlan.clipWidth, height: renderPlan.clipHeight } : { width: '100%', height: '100%' }} /> : <div className="no-pdf"><span>AnOOPlan / {floor.name.toUpperCase()}</span><p>Рабочее поле без PDF</p><small>{project.name.includes('Учеб') ? 'Синтетическая схема для проверки расчёта' : 'Загрузите план PDF и задайте масштаб по двум точкам'}</small></div>}
          <svg className="plan-overlay" width={floor.width} height={floor.height} viewBox={`0 0 ${floor.width} ${floor.height}`}>
            <defs><pattern id="drawing-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#63828e" strokeOpacity=".19" strokeWidth={.5 / zoom} /></pattern></defs>
            {grid && <rect width="100%" height="100%" fill="url(#drawing-grid)" pointerEvents="none" />}
            {project.routes.flatMap(r => r.segments.map((s, index) => {
              const visibleA = s.a.floorId === floor.id, visibleB = s.b.floorId === floor.id; if (!visibleA && !visibleB) return null;
              const chosen = cableSegments.includes(s.id) || cable?.segmentIds.includes(s.id); const selected = selection?.id === r.id;
              return <g key={s.id} data-object="segment" data-id={s.id} data-route={r.id} className={`route-segment ${chosen ? 'cable-selected' : ''} ${selected ? 'is-selected' : ''}`} style={{ '--route-color': routeColor(r) } as unknown as import('react').CSSProperties} onDoubleClick={e => { if (tool !== 'select') return; e.preventDefault(); e.stopPropagation(); const p = position(e, false); insertVertex(r.id, s.id, p); }} onPointerDown={e => { e.stopPropagation(); if (pinching.current) return; if (tool === 'cable') armTap(e, () => setCableSegments(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])); else if (tool === 'route') armTap(e, () => { const p = position(e); setDraft(points => [...points, p]); }); else if (tool === 'select') armTap(e, () => setSelection({ kind: 'route', id: r.id })); }}>
                <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="transparent" strokeWidth={26 / zoom} />
                <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={(chosen ? 5 : selected ? 4 : 3) / zoom} className="visible-route" pointerEvents="none" strokeDasharray={!visibleA || !visibleB ? `${7 / zoom} ${4 / zoom}` : undefined} />
                {(!visibleA || !visibleB) && <g transform={`translate(${s.a.x},${s.a.y})`}><circle r={9 / zoom} fill="white" stroke={routeColor(r)} strokeWidth={2 / zoom} /><text textAnchor="middle" y={4 / zoom} fontSize={12 / zoom} fill={routeColor(r)}>↕</text></g>}
                {(selected || chosen) && <text x={(s.a.x + s.b.x) / 2 + 6 / zoom} y={(s.a.y + s.b.y) / 2 - 7 / zoom} fontSize={11 / zoom} fill="#126e71" className="svg-label">{tool === 'cable' ? cableSegments.indexOf(s.id) + 1 || '' : `${r.number}.${index + 1}`}</text>}
              </g>;
            }))}
            {snapMark && <g className="snap-mark" pointerEvents="none"><circle cx={snapMark.x} cy={snapMark.y} r={7 / zoom} fill="none" stroke="#e78c22" strokeWidth={2 / zoom} /><path d={`M ${snapMark.x - 11 / zoom} ${snapMark.y} h ${22 / zoom} M ${snapMark.x} ${snapMark.y - 11 / zoom} v ${22 / zoom}`} stroke="#e78c22" strokeWidth={1.5 / zoom} /></g>}
            {(project.dimensions ?? []).map(dimension => {
              const geometry = dimensionGeometry(project, dimension);
              const from = project.equipment.find(item => item.id === dimension.fromId);
              const to = project.equipment.find(item => item.id === dimension.toId);
              if (geometry.floorId !== floor.id || geometry.units === null || !from || !to) return null;
              const angle = Math.atan2(to.y - from.y, to.x - from.x);
              const offset = 10 / zoom;
              const normalX = -Math.sin(angle) * offset;
              const normalY = Math.cos(angle) * offset;
              const x1 = from.x + normalX;
              const y1 = from.y + normalY;
              const x2 = to.x + normalX;
              const y2 = to.y + normalY;
              const selected = selection?.kind === 'dimension' && selection.id === dimension.id;
              return <g key={dimension.id} data-object="dimension" data-id={dimension.id} className={`plan-dimension ${selected ? 'is-selected' : ''}`} onPointerDown={event => { event.stopPropagation(); if (tool === 'select') armTap(event, () => setSelection({ kind: 'dimension', id: dimension.id })); }}>
                <line x1={from.x} y1={from.y} x2={x1} y2={y1} stroke="#875ec5" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />
                <line x1={to.x} y1={to.y} x2={x2} y2={y2} stroke="#875ec5" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#875ec5" strokeWidth={(selected ? 2.5 : 1.5) / zoom} />
                <line x1={x1 - normalX / 2} y1={y1 - normalY / 2} x2={x1 + normalX / 2} y2={y1 + normalY / 2} stroke="#875ec5" strokeWidth={1.5 / zoom} />
                <line x1={x2 - normalX / 2} y1={y2 - normalY / 2} x2={x2 + normalX / 2} y2={y2 + normalY / 2} stroke="#875ec5" strokeWidth={1.5 / zoom} />
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={18 / zoom} />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6 / zoom} textAnchor="middle" fontSize={12 / zoom} fill="#875ec5" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" className="svg-label">{dimensionText(geometry)}</text>
              </g>;
            })}
            {project.equipment.filter(eq => eq.floorId === floor.id).map(eq => <g data-object="equipment" data-id={eq.id} data-icon={equipmentIcon(eq.type)} data-color={equipmentColor(eq)} key={eq.id} transform={`translate(${eq.x},${eq.y})`} className={`equipment-symbol ${selection?.id === eq.id ? 'is-selected' : ''}`} onPointerDown={e => { if (pinching.current) return; if (tool === 'select') { setSelection({ kind: 'equipment', id: eq.id }); startDrag(e, 'equipment', eq.id); } else if (tool === 'route') { e.stopPropagation(); armTap(e, () => setDraft(points => { const p = { x: eq.x, y: eq.y }; const last = points[points.length - 1]; return ortho && last && last.x !== p.x && last.y !== p.y ? [...points, { x: p.x, y: last.y }, p] : [...points, p]; })); } else if (tool === 'cable') { e.stopPropagation(); armTap(e, () => { if (!cableFrom) { setCableFrom(eq.id); setMessage(`Начало: ${eq.number}. Коснитесь конечного устройства.`); } else if (cableTo !== eq.id) { setCableTo(eq.id); const res = findRoute(project, cableFrom, eq.id); if (res.error) { setCableSegments([]); setError(res.error); } else { setCableSegments(res.segmentIds); setMessage(`Конец: ${eq.number}. Маршрут построен автоматически: ${res.segmentIds.length} сегм.`); } } }); } else if (tool === 'dimension') { e.stopPropagation(); armTap(e, () => {
                if (!dimensionFrom) { setDimensionFrom(eq.id); setMessage(`Размер: ${eq.number} — выберите второе оборудование.`); return; }
                if (dimensionFrom === eq.id) { setMessage('Для размера выберите другое оборудование.'); return; }
                const from = project.equipment.find(item => item.id === dimensionFrom);
                if (!from) { setDimensionFrom(null); return; }
                if (from.floorId !== eq.floorId) { setError('Размер между оборудованием разных этажей не поддерживается.'); setDimensionFrom(null); return; }
                const id = createUuid();
                mutate(p => { p.dimensions = [...(p.dimensions ?? []), { id, fromId: from.id, toId: eq.id }]; });
                setDimensionFrom(null); setSelection({ kind: 'dimension', id }); setMessage(`Размер: ${from.number} — ${eq.number}.`);
              }); } }}>
              <EquipmentSymbol item={eq} zoom={zoom} />
            </g>)}
            {project.pins.filter(pin => pin.floorId === floor.id).map(pin => <g data-object="pin" data-id={pin.id} key={pin.id} transform={`translate(${pin.x},${pin.y})`} className={`pin-symbol ${selection?.id === pin.id ? 'is-selected' : ''}`} onPointerDown={e => { e.stopPropagation(); if (pinching.current) return; if (tool === 'select') { setSelection({ kind: 'pin', id: pin.id }); setTab('pins'); setView('plan'); } }}>
              <circle r={9 / zoom} fill={pin.status === 'closed' ? '#2f9e63' : '#e78c22'} stroke="#fff" strokeWidth={2 / zoom} />
              <text x={13 / zoom} y={4 / zoom} fontSize={12 / zoom} className="svg-label" fill="#122936">{pin.number}</text>
            </g>)}
{route && tool === 'select' && Array.from(new Map(route.segments.flatMap(s => [s.a, s.b]).filter(v => v.floorId === floor.id).map(v => [v.id, v])).values()).map(v => <circle data-object="vertex" data-route={route.id} key={v.id} cx={v.x} cy={v.y} r={5 / zoom} fill="white" stroke="#008e94" strokeWidth={2 / zoom} className="vertex-handle" aria-label="Вершина трассы, двойной клик — удалить" onDoubleClick={event => { if (tool !== 'select') return; event.preventDefault(); event.stopPropagation(); deleteVertex(route.id, v.id); }} onPointerDown={e => startDrag(e, 'vertex', route.id, v.id)} />)}
            {draft.length > 0 && <g pointerEvents="none"><polyline points={draft.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e78c22" strokeWidth={3 / zoom} strokeDasharray={`${6 / zoom} ${3 / zoom}`} />{draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / zoom} fill="#e78c22" />)}</g>}
            {calibration.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={6 / zoom} fill="#dc5071" pointerEvents="none" />)}
            {measure.length > 0 && <g pointerEvents="none">
              {measureMode === 'area' && measure.length >= 3
                ? <polygon points={measure.map(point => `${point.x},${point.y}`).join(' ')} fill="#875ec5" fillOpacity={0.16} stroke="#875ec5" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
                : measure.length === 2 ? <line x1={measure[0].x} y1={measure[0].y} x2={measure[1].x} y2={measure[1].y} stroke="#875ec5" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} /> : null}
              {measure.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={5 / zoom} fill="#875ec5" />)}
              {measure.length >= (measureMode === 'area' ? 3 : 2) && <text
                x={(measureMode === 'area' ? measure.reduce((sum, point) => sum + point.x, 0) / measure.length : (measure[0].x + measure[1].x) / 2) + 8 / zoom}
                y={(measureMode === 'area' ? measure.reduce((sum, point) => sum + point.y, 0) / measure.length : (measure[0].y + measure[1].y) / 2) - 8 / zoom}
                fontSize={12 / zoom} fill="#875ec5" className="svg-label">{measureLabel()}</text>}
            </g>}
          </svg>
        </div>}
        <div className="plan-zoom" data-object="controls" onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={fit} aria-label="Вписать план" title="Вписать план">⤢</button>
          <button type="button" onClick={() => changeZoom(zoom / 1.2)} aria-label="Уменьшить масштаб">−</button>
          <output className="plan-zoom-value" aria-label="Текущий масштаб">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => changeZoom(zoom * 1.2)} aria-label="Увеличить масштаб">＋</button>
        </div>
        <div className="plan-badge"><span className="dot calibrated" />{floor?.name || 'Нет этажей'}<span> / </span>{floor?.metersPerUnit ? `${number(floor.metersPerUnit)} м/ед.` : 'Масштаб не задан'}</div>
        <div className="plan-legend">{(() => { const seen = new Map<string, string>(); for (const route of project.routes) { const label = route.type || 'Трасса'; if (!seen.has(label)) seen.set(label, routeColor(route)); } const items = [...seen.entries()].slice(0, 5); return items.length ? items.map(([label, color]) => <span key={label}><i className="legend-line" style={{ background: color }} />{label}{' '}</span>) : <><span className="legend-line" />Трасса</>; })()}<span className="legend-equipment" /> Оборудование <span className="legend-cable" /> Выбранный кабель</div>
      </div><div className="tool-hint"><span>{TOOL_META[tool].hint}</span><small>Координаты PDF: {pointer ? `${number(pointer.x)}; ${number(pointer.y)}` : '—'}</small></div><PlanAccessibilityList project={project} floor={floor} />
      {toolsMoreOpen && <ToolMoreSheet ui={ui} returnFocus={moreButtonRef} />}
</div>
  );
}
