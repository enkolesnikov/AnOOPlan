import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Cable, Equipment, Pin, Point, Route, Vertex } from '../model';
import { chainEnds } from '../engine';
import { createUuid as uid, cloneValue as clone } from '../compat';
import { CABLE_SNAP_LIMIT, SNAP_PX } from './constants';
import { areaLabel, number } from './format';
import { vibrate } from './native';
import { nextPinNumber } from './project-helpers';
import type { ObjectKind } from './types';
import type { WorkspaceState } from './use-workspace-state';

/** Инструменты плана: камера, привязки, указатели, калибровка, трассы, кабели и замечания. */
export function usePlanEditing(s: WorkspaceState) {
  const {
    project, projectRef, floor, stage, zoom, pan, setZoom, setPan, snap, gridSize, ortho,
    tool, setTool, draft, setDraft, calibration, setCalibration, measure, setMeasure, measureMode,
    setPointer, setSelection, setTab, setPropsOpen, setSheet, route, routeHeight,
    cableFrom, setCableFrom, cableTo, setCableTo, cableSegments, setCableSegments,
    setMessage, setError, setProject, mutate, recordHistory,
    drag, pointers, tap, pinching, snapVibe, pressStart, longPressTimer,
  } = s;
  function fit() {
    if (!stage.current || !floor) return;
    const z = Math.max(.04, Math.min(4, Math.min((stage.current.clientWidth - 64) / floor.width, (stage.current.clientHeight - 64) / floor.height)));
    setZoom(z); setPan({ x: (stage.current.clientWidth - floor.width * z) / 2, y: (stage.current.clientHeight - floor.height * z) / 2 });
  }
  function changeZoom(value: number) {
    const z = Math.max(.04, Math.min(8, value));
    const center = { x: (stage.current?.clientWidth || 800) / 2, y: (stage.current?.clientHeight || 600) / 2 };
    setPan({ x: center.x - (center.x - pan.x) * z / zoom, y: center.y - (center.y - pan.y) * z / zoom }); setZoom(z);
  }

  function position(e: { clientX: number; clientY: number }, useSnap = true): Point {
    const rect = stage.current!.getBoundingClientRect();
    let x = (e.clientX - rect.left - pan.x) / zoom, y = (e.clientY - rect.top - pan.y) / zoom;
    if (snap && useSnap) {
      const candidates = [...project.equipment.filter(eq => eq.floorId === floor?.id), ...project.routes.flatMap(r => r.segments.flatMap(s => [s.a, s.b])).filter(v => v.floorId === floor?.id)];
      const near = candidates.find(p => Math.hypot(p.x - x, p.y - y) < SNAP_PX / zoom);
      if (near) {
        if (!snapVibe.current) { snapVibe.current = true; vibrate(8); }
        return { x: near.x, y: near.y };
      }
      snapVibe.current = false;
      x = Math.round(x / gridSize) * gridSize; y = Math.round(y / gridSize) * gridSize;
    }
    return { x, y };
  }
  const TAP_SLOP = 10;
  const TAP_DELAY = 700;
  const tapSlop = { x: 0, y: 0 };

  function armTap(event: ReactPointerEvent, run: () => void) {
    // Действие выполняется только по одиночному тапу: жест масштабирования
    // (второй палец) и перетаскивание листа отменяют нажатие.
    tap.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), run };
  }
  function runTap(event: ReactPointerEvent): boolean {
    const pending = tap.current;
    tap.current = null;
    if (!pending || pending.pointerId !== event.pointerId) return false;
    if (Date.now() - pending.at > TAP_DELAY) return false;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > TAP_SLOP) return false;
    pending.run();
    return true;
  }
  function startDrag(e: ReactPointerEvent, type: 'equipment' | 'vertex', id: string, vertexId?: string) {
    if (tool !== 'select' || pinching.current) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    drag.current = { type, id, vertexId, start: position(e), pan, before: clone(projectRef.current) };
  }
  function pointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!floor) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 || pinching.current) return;
    if ((e.target as Element).closest('[data-object]')) return;
    if (tool === 'pan' || e.button === 1) {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не критично */ }
      drag.current = { type: 'pan', start: { x: e.clientX, y: e.clientY }, pan, before: clone(projectRef.current) };
      return;
    }
    const p = position(e);
    if (p.x < 0 || p.y < 0 || p.x > floor.width || p.y > floor.height) return;
    const targetFloor = floor;
    if (tool === 'equipment') {
      armTap(e, () => {
        const usedNumbers = new Set(projectRef.current.equipment.map(item => item.number));
        let n = projectRef.current.equipment.length + 1;
        while (usedNumbers.has(`E${n}`)) n++;
        const usedNames = new Set(projectRef.current.equipment.map(item => item.name.trim()));
        let itemName = 'Новое оборудование';
        let suffix = 1;
        while (usedNames.has(itemName)) itemName = `Новое оборудование ${++suffix}`;
        const item: Equipment = { id: uid(), number: `E${n}`, name: itemName, type: 'Оборудование', floorId: targetFloor.id, ...p, height: null, note: '', properties: {}, photos: [] };
        mutate(pr => pr.equipment.push(item)); setSelection({ kind: 'equipment', id: item.id }); setTab('equipment');
      });
    } else if (tool === 'route') {
      armTap(e, () => setDraft(points => {
        const last = points[points.length - 1];
        if (last && Math.hypot(last.x - p.x, last.y - p.y) < .001) return points;
        if (ortho && last && last.x !== p.x && last.y !== p.y) return [...points, { x: p.x, y: last.y }, p];
        return [...points, p];
      }));
    } else if (tool === 'calibrate') {
      armTap(e, () => placeCalibrationPoint(p));
    } else if (tool === 'measure') {
      armTap(e, () => placeMeasurePoint(p));
    } else if (tool === 'pin') {
      armTap(e, () => createPin(p));
    } else if (tool === 'select') {
      armTap(e, () => setSelection(null));
    }
  }

  function placeCalibrationPoint(p: Point) {
    if (!floor) return;
    if (!calibration.length) { setCalibration([p]); setMessage('Укажите вторую точку известного размера.'); return; }
    const length = Math.hypot(p.x - calibration[0].x, p.y - calibration[0].y);
    if (!length) return;
    const answer = window.prompt('Расстояние между точками, в метрах:', '10');
    if (answer !== null) {
      const meters = Number(answer.replace(',', '.'));
      if (meters > 0 && Number.isFinite(meters)) {
        mutate(pr => { pr.floors.find(f => f.id === floor.id)!.metersPerUnit = meters / length; });
        setMessage(`Масштаб: ${number(meters / length)} м/ед. PDF. Проверьте контрольный размер.`);
        setTool('select');
      } else setError('Расстояние должно быть положительным числом.');
    }
    setCalibration([]);
  }
  function placeMeasurePoint(p: Point) {
    if (measureMode === 'area') {
      // Площадь: тап добавляет вершину, полигон замыкается сам.
      const next = [...measure, p];
      setMeasure(next);
      if (next.length < 3) { setMessage(`Площадь: добавьте ещё ${3 - next.length} точку, чтобы замкнуть контур.`); return; }
      setMessage(`Площадь: ${areaLabel(next, floor?.metersPerUnit)} по контуру из ${next.length} точек.`);
      return;
    }
    // Рулетка: первая точка — начало, вторая — конец; третий тап начинает заново.
    if (measure.length >= 2) { setMeasure([p]); setMessage('Рулетка: укажите вторую точку.'); return; }
    if (!measure.length) { setMeasure([p]); setMessage('Рулетка: укажите вторую точку.'); return; }
    const start = measure[0];
    setMeasure([start, p]);
    const units = Math.hypot(p.x - start.x, p.y - start.y);
    const scale = floor?.metersPerUnit;
    if (scale && scale > 0) setMessage(`Рулетка: ${number(units * scale)} м между точками.`);
    else setMessage(`Рулетка: ${number(units)} ед. PDF. Масштаб не задан — откалибруйте лист, чтобы получить метры.`);
  }

  function pointerMove(e: ReactPointerEvent) {
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > TAP_SLOP) tap.current = null;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const active = drag.current;
    if (active?.type === 'pinch') {
      if (pointers.current.size < 2) return;
      const rect = stage.current!.getBoundingClientRect();
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const nextZoom = Math.max(.04, Math.min(8, (active.startZoom ?? zoom) * dist / (active.startDist || 1)));
      const origin = active.startPdf ?? { x: 0, y: 0 };
      setZoom(nextZoom);
      setPan({ x: mid.x - rect.left - origin.x * nextZoom, y: mid.y - rect.top - origin.y * nextZoom });
      return;
    }
    setPointer(position(e, false));
    if (!active) return;
    if (active.type === 'pan') { setPan({ x: active.pan.x + e.clientX - active.start.x, y: active.pan.y + e.clientY - active.start.y }); return; }
    const point = position(e); const next = clone(projectRef.current);
    if (active.type === 'equipment') { const item = next.equipment.find(eq => eq.id === active.id); if (item) Object.assign(item, point); }
    else {
      const original = active.before.routes.find(r => r.id === active.id)?.segments.flatMap(s => [s.a, s.b]).find(v => v.id === active.vertexId);
      if (original) next.routes.forEach(r => r.segments.forEach(s => [s.a, s.b].forEach(v => { if (v.id === active.vertexId || (v.floorId === original.floorId && v.x === original.x && v.y === original.y && v.height === original.height)) Object.assign(v, point); })));
    }
    projectRef.current = next; setProject(next);
  }
  function pointerUp(e: ReactPointerEvent) {
    cancelLongPress();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinching.current = false;
    const active = drag.current;
    if (active?.type === 'pinch') { if (pointers.current.size < 2) drag.current = null; return; }
    if (active && active.type !== 'pan' && JSON.stringify(active.before) !== JSON.stringify(projectRef.current)) recordHistory(active.before);
    drag.current = null;
    if (!active) runTap(e);
  }
  function pointerCancel(e: ReactPointerEvent) {
    tap.current = null;
    cancelLongPress();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinching.current = false;
    drag.current = null;
  }

  function finishRoute() {
    if (!floor || draft.length < 2) return;
    const h = routeHeight === '' ? null : Number(routeHeight);
    if (h !== null && !Number.isFinite(h)) { setError('Задайте числовую высоту трассы.'); return; }
    const vertices: Vertex[] = draft.map(p => ({ id: uid(), floorId: floor.id, ...p, height: h }));
    const item: Route = { id: uid(), number: `T${project.routes.length + 1}`, type: 'Лоток', note: '', segments: vertices.slice(1).map((b, i) => ({ id: uid(), a: vertices[i], b, mode: ortho ? 'orthogonal' : 'spatial', reservePercent: 0, reserveFixed: 0 })) };
    mutate(p => p.routes.push(item)); setSelection({ kind: 'route', id: item.id }); setDraft([]); setTool('select'); setTab('routes'); setMessage('Трасса создана. Проверьте высоты и привязку концов.');
  }
  function createPin(point: Point) {
    if (!floor) return;
    const now = new Date().toISOString();
    const item: Pin = {
      id: uid(), number: nextPinNumber(projectRef.current), floorId: floor.id, x: point.x, y: point.y,
      comment: '', status: 'open', photos: [], createdAt: now, updatedAt: now,
    };
    mutate(p => p.pins.push(item));
    setSelection({ kind: 'pin', id: item.id });
    setTab('pins');
    setTool('select');
    setPropsOpen(true);
    setMessage(`Замечание ${item.number} добавлено. Заполните текст и при необходимости приложите фото.`);
  }
  function finishCable() {
    if (!cableFrom || !cableTo) { setError('Сначала выберите оборудование «От» и «До»: по очереди коснитесь двух устройств на плане.'); return; }
    if (cableFrom === cableTo) { setError('«От» и «До» должны быть разными устройствами.'); return; }
    if (!cableSegments.length) { setError('Выберите сегменты трассы по порядку: коснитесь каждого сегмента, по которому идёт кабель.'); return; }
    const ends = chainEnds(project, cableSegments);
    if (!ends) { setError('Выбранные сегменты не образуют непрерывную цепочку. Выберите их по порядку от начала к концу.'); return; }
    const fromEq = project.equipment.find(e => e.id === cableFrom);
    const toEq = project.equipment.find(e => e.id === cableTo);
    if (fromEq && toEq) {
      const dist = (v: Vertex, e: Equipment) => v.floorId === e.floorId ? Math.hypot(v.x - e.x, v.y - e.y) : Infinity;
      const dStart = dist(ends.start, fromEq), dEnd = dist(ends.end, fromEq);
      if (Math.min(dStart, dEnd) > CABLE_SNAP_LIMIT || Math.min(dist(ends.start, toEq), dist(ends.end, toEq)) > CABLE_SNAP_LIMIT) {
        setError('Концы трассы слишком далеко от выбранных устройств. Начертите трассу, начиная и заканчивая на устройствах, или подвиньте устройства к концам трассы.'); return;
      }
      const fromEnd = dStart <= dEnd ? ends.start : ends.end;
      const toEnd = dStart <= dEnd ? ends.end : ends.start;
      mutate(p => {
        const f = p.equipment.find(e => e.id === cableFrom)!;
        const t = p.equipment.find(e => e.id === cableTo)!;
        f.floorId = fromEnd.floorId; f.x = fromEnd.x; f.y = fromEnd.y;
        t.floorId = toEnd.floorId; t.x = toEnd.x; t.y = toEnd.y;
      });
    }
    let n = project.cables.length + 1;
    const used = new Set(project.cables.map(c => c.number));
    while (used.has(`K${n}`)) n++;
    const item: Cable = { id: uid(), number: `K${n}`, name: 'Новый кабель', brand: '', purpose: '', fromId: cableFrom, toId: cableTo, segmentIds: [...cableSegments], reservePercent: 0, reserveFixed: 0, startReserve: 0, endReserve: 0, quantity: 1, note: '' };
    mutate(p => p.cables.push(item)); setSelection({ kind: 'cable', id: item.id }); setTab('cables'); setTool('select'); setCableSegments([]); setMessage(`Кабель ${`K${n}`} создан. Устройства привязаны к концам трассы.`);
  }

  function openObjectSheet(kind: ObjectKind, id: string) {
    cancelLongPress();
    setSelection({ kind, id });
    setSheet({ kind, id });
    setPropsOpen(false);
    vibrate(18);
  }

  function cancelLongPress() {
    if (longPressTimer.current !== null) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    pressStart.current = null;
  }
  function beginLongPress(event: ReactPointerEvent, fire: () => void) {
    cancelLongPress();
    pressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => { longPressTimer.current = null; fire(); }, 550);
  }
  function moveLongPress(event: ReactPointerEvent) {
    if (longPressTimer.current === null || !pressStart.current) return;
    if (Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 10) cancelLongPress();
  }
  function zoomAt(clientX: number, clientY: number, target: number) {
    const rect = stage.current?.getBoundingClientRect(); if (!rect) return;
    const next = Math.max(.04, Math.min(8, target));
    const px = (clientX - rect.left - pan.x) / zoom, py = (clientY - rect.top - pan.y) / zoom;
    setZoom(next); setPan({ x: clientX - rect.left - px * next, y: clientY - rect.top - py * next });
  }
  function listPressDown(event: ReactPointerEvent) {
    const row = (event.target as Element).closest('.object-row[data-id]') as HTMLElement | null;
    if (!row) return;
    const kind = row.dataset.kind as ObjectKind | undefined;
    const id = row.dataset.id;
    if (!kind || !id) return;
    beginLongPress(event, () => openObjectSheet(kind, id));
  }
  function stagePressDown(event: ReactPointerEvent) {
    // Второй палец — это масштабирование/панорама: отменяем тап, долгое нажатие
    // и откатываем начатое перетаскивание объекта.
    if (pointers.current.size >= 1 && !pinching.current) {
      tap.current = null;
      cancelLongPress();
      pinching.current = true;
      const active = drag.current;
      if (active && (active.type === 'equipment' || active.type === 'vertex')) {
        setProject(active.before);
        projectRef.current = active.before;
      }
      const first = [...pointers.current.values()][0];
      const rect = stage.current!.getBoundingClientRect();
      const mid = { x: (first.x + event.clientX) / 2, y: (first.y + event.clientY) / 2 };
      drag.current = {
        type: 'pinch', start: { x: 0, y: 0 }, pan, before: projectRef.current,
        startDist: Math.hypot(first.x - event.clientX, first.y - event.clientY) || 1,
        startZoom: zoom, startPan: pan,
        startPdf: { x: (mid.x - rect.left - pan.x) / zoom, y: (mid.y - rect.top - pan.y) / zoom },
      };
      return;
    }
    const element = (event.target as Element).closest('[data-object]') as HTMLElement | null;
    if (!element) return;
    const kind = element.getAttribute('data-object');
    const id = element.getAttribute('data-id');
    const owner = element.getAttribute('data-route');
    if (kind === 'equipment' && id) beginLongPress(event, () => openObjectSheet('equipment', id));
    else if ((kind === 'segment' || kind === 'vertex') && owner) beginLongPress(event, () => openObjectSheet('route', owner));
  }
  return {
    fit, changeZoom, position, armTap, startDrag,
    pointerDown, pointerMove, pointerUp, pointerCancel,
    finishRoute, createPin, finishCable, openObjectSheet,
    cancelLongPress, moveLongPress, zoomAt, listPressDown, stagePressDown, pinching,
  };
}
export type PlanEditing = ReturnType<typeof usePlanEditing>;
