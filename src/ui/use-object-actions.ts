import type { Cable, Equipment, Pin, Route, Segment, Vertex } from '../model';
import type { JournalSectionId } from '../export-pdf';
import { cloneValue as clone, createUuid as uid } from '../compat';
import { compressPhoto } from '../photo-compress';
import { orphanPhotoKeys, purgePhotoBlobs } from '../photos';
import { idbDelete, idbPut } from '../idb';
import { api } from './api';
import { JOURNAL_SECTIONS, SHEET_SIZES } from './constants';
import { number } from './format';
import { nextPinNumber, uniqueNumber } from './project-helpers';
import { affectedCableIds } from './multi-select';
import type { ObjectKind } from './types';
import type { WorkspaceState } from './use-workspace-state';

/** Действия над объектами проекта: копирование, удаление, свойства, фото, масштаб и стояки. */
export function useObjectActions(s: WorkspaceState) {
  const {
    project, projectRef, selection, photoOwner, floor, route, gridSize, staticMode,
    sheetFormat, sheetScale, setSelection, setSheet, setPropsOpen, setTab, setMessage, setError,
    mutate, setPrintSections, setMulti,
  } = s;
  function copyObject(kind: ObjectKind, id: string) {
    const source = projectRef.current;
    if (kind === 'equipment') {
      const item = source.equipment.find(e => e.id === id); if (!item) return;
      const used = new Set(source.equipment.map(e => e.number));
      const next: Equipment = { ...clone(item), id: uid(), number: uniqueNumber(item.number, used), x: item.x + gridSize, y: item.y + gridSize, photos: [] };
      mutate(p => p.equipment.push(next), 'Дублирование'); setSelection({ kind: 'equipment', id: next.id }); setMessage(`Копия оборудования: ${next.number}.`);
      return;
    }
    if (kind === 'pin') {
      const item = source.pins.find(pin => pin.id === id); if (!item) return;
      const next: Pin = { ...clone(item), id: uid(), number: nextPinNumber(projectRef.current), x: item.x + gridSize, y: item.y + gridSize, photos: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mutate(p => p.pins.push(next), 'Дублирование'); setSelection({ kind: 'pin', id: next.id }); setTab('pins'); setMessage(`Копия замечания: ${next.number}.`);
      return;
    }
    if (kind === 'route') {
      const item = source.routes.find(r => r.id === id); if (!item) return;
      const used = new Set(source.routes.map(r => r.number));
      const next = clone(item);
      next.id = uid(); next.number = uniqueNumber(item.number, used);
      const vertexIds = new Map<string, string>();
      next.segments.forEach(segment => { segment.id = uid(); [segment.a, segment.b].forEach(vertex => { if (!vertexIds.has(vertex.id)) vertexIds.set(vertex.id, uid()); vertex.id = vertexIds.get(vertex.id)!; vertex.x += gridSize; vertex.y += gridSize; }); });
      mutate(p => p.routes.push(next), 'Дублирование'); setSelection({ kind: 'route', id: next.id }); setMessage(`Копия трассы: ${next.number}.`);
      return;
    }
    const item = source.cables.find(c => c.id === id); if (!item) return;
    const used = new Set(source.cables.map(c => c.number));
    const next: Cable = { ...clone(item), id: uid(), number: uniqueNumber(item.number, used) };
    mutate(p => p.cables.push(next), 'Дублирование'); setSelection({ kind: 'cable', id: next.id }); setMessage(`Копия кабеля: ${next.number}.`);
  }
  function removeObject(kind: ObjectKind, id: string) {
    const source = projectRef.current;
    const target = kind === 'equipment' ? source.equipment.find(e => e.id === id)
      : kind === 'route' ? source.routes.find(r => r.id === id)
      : kind === 'pin' ? source.pins.find(pin => pin.id === id)
      : source.cables.find(c => c.id === id);
    if (!target) return;
    const segmentIds = kind === 'route' ? (target as Route).segments.map(s => s.id) : [];
    const affected = source.cables.filter(c => kind === 'equipment' ? c.fromId === id || c.toId === id : kind === 'route' ? c.segmentIds.some(s => segmentIds.includes(s)) : false);
    const label = kind === 'equipment' ? 'оборудование' : kind === 'route' ? 'трассу' : kind === 'pin' ? 'замечание' : 'кабель';
    if (!window.confirm(`Удалить ${label} ${target.number}?${affected.length ? ` Также будут удалены связанные кабели: ${affected.map(c => c.number).join(', ')}.` : ''}`)) return;
    // Фото лежат в IndexedDB отдельно от проекта: без явной очистки они остаются сиротами.
    const photoKeys = kind === 'equipment' || kind === 'pin' ? orphanPhotoKeys(source, [id]) : [];
    mutate(p => {
      if (kind === 'equipment') p.equipment = p.equipment.filter(e => e.id !== id);
      if (kind === 'route') p.routes = p.routes.filter(r => r.id !== id);
      if (kind === 'pin') p.pins = p.pins.filter(pin => pin.id !== id);
      p.cables = p.cables.filter(c => c.id !== (kind === 'cable' ? id : '') && !affected.some(a => a.id === c.id));
    }, 'Удаление');
    void purgePhotoBlobs(photoKeys, idbDelete);
    setSelection(null); setSheet(null); setPropsOpen(false);
  }

  /** Массовое удаление выбранных на вкладке объектов с очисткой кабелей и фото. */
  function removeMany(kind: ObjectKind, ids: string[]): void {
    const source = projectRef.current;
    const selected = new Set(ids);
    const targets = kind === 'equipment' ? source.equipment.filter(item => selected.has(item.id))
      : kind === 'route' ? source.routes.filter(item => selected.has(item.id))
        : kind === 'pin' ? source.pins.filter(item => selected.has(item.id))
          : source.cables.filter(item => selected.has(item.id));
    if (targets.length === 0) { setMulti(null); return; }
    const cableIds = new Set(affectedCableIds(source, kind, ids));
    const affected = source.cables.filter(cable => cableIds.has(cable.id));
    const label = kind === 'equipment' ? 'оборудование' : kind === 'route' ? 'трассы' : kind === 'pin' ? 'замечания' : 'кабели';
    if (!window.confirm(`Удалить выбранные ${label}: ${targets.length}?${affected.length ? ` Также будут удалены связанные кабели: ${affected.length}.` : ''}`)) return;
    const photoKeys = kind === 'equipment' || kind === 'pin' ? orphanPhotoKeys(source, ids) : [];
    mutate(p => {
      if (kind === 'equipment') p.equipment = p.equipment.filter(item => !selected.has(item.id));
      if (kind === 'route') p.routes = p.routes.filter(item => !selected.has(item.id));
      if (kind === 'pin') p.pins = p.pins.filter(item => !selected.has(item.id));
      p.cables = p.cables.filter(cable => !cableIds.has(cable.id));
    }, 'Массовое удаление');
    void purgePhotoBlobs(photoKeys, idbDelete);
    setSelection(null); setSheet(null); setPropsOpen(false); setMulti(null);
    setMessage(`Удалено: ${targets.length}${affected.length ? `, кабелей: ${affected.length}` : ''}.`);
  }

  /** Массовый перенос оборудования/замечаний на другой этаж. */
  function moveMany(kind: 'equipment' | 'pin', ids: string[], floorId: string): void {
    const targetFloor = projectRef.current.floors.find(item => item.id === floorId);
    if (!targetFloor || ids.length === 0) return;
    const selected = new Set(ids);
    mutate(p => {
      const collection = kind === 'equipment' ? p.equipment : p.pins;
      for (const item of collection) if (selected.has(item.id)) item.floorId = floorId;
    }, 'Перенос на этаж');
    setSelection(null); setMulti(null);
    setMessage(`Перенесено на «${targetFloor.name}»: ${ids.length}.`);
  }

  function copySelection() {
    if (!selection) return;
    if (selection.kind === 'dimension') { setMessage('Размер между оборудованием нельзя копировать — создайте новый на плане.'); return; }
    copyObject(selection.kind, selection.id);
  }
  function removeSelection() {
    if (!selection) return;
    if (selection.kind === 'dimension') {
      const dimension = (projectRef.current.dimensions ?? []).find(d => d.id === selection.id);
      if (!dimension) return;
      mutate(p => { p.dimensions = (p.dimensions ?? []).filter(d => d.id !== dimension.id); });
      setSelection(null); setPropsOpen(false); setMessage('Размер удалён.');
      return;
    }
    removeObject(selection.kind, selection.id);
  }

  async function addPhoto(file: File) {
    const target = photoOwner;
    if (!target) return;
    const pinTarget = selection?.kind === 'pin';
    const key = uid();
    await idbPut('photo:' + key, await compressPhoto(file));
    mutate(p => {
      if (pinTarget) {
        const item = p.pins.find(pin => pin.id === target.id);
        if (item) item.photos = [...(item.photos || []), key];
      } else {
        const item = p.equipment.find(eq => eq.id === target.id);
        if (item) item.photos = [...(item.photos || []), key];
      }
    });
    setMessage(`Фото прикреплено к ${target.number}${file.name ? `: ${file.name}` : ''}.`);
  }
  function removePhoto(key: string) {
    if (!photoOwner) return;
    const targetId = photoOwner.id;
    const pinTarget = selection?.kind === 'pin';
    mutate(p => {
      const item = pinTarget ? p.pins.find(pin => pin.id === targetId) : p.equipment.find(eq => eq.id === targetId);
      if (item) item.photos = (item.photos || []).filter(itemKey => itemKey !== key);
    });
    void idbDelete('photo:' + key).catch(() => { /* файл останется в хранилище */ });
    setMessage('Фото удалено из проекта.');
  }
  function setItem(key: string, value: unknown) {
    if (!selection) return;
    mutate(p => { const collection = selection.kind === 'equipment' ? p.equipment : selection.kind === 'route' ? p.routes : p.cables; const item = collection.find(i => i.id === selection.id); if (item) Object.assign(item, { [key]: value }); }, 'Правка поля');
  }

  function applySheetScale() {
    if (!floor) return;
    const size = SHEET_SIZES[sheetFormat] ?? SHEET_SIZES.A1;
    const denominator = Number(sheetScale);
    const millimeters = floor.width >= floor.height ? size.landscape : size.portrait;
    const meters = (millimeters * denominator) / 1000;
    if (!Number.isFinite(floor.width) || floor.width <= 0 || !Number.isFinite(meters) || meters <= 0) {
      setError('Сначала загрузите PDF-подложку: без неё неизвестна ширина листа.');
      return;
    }
    const metersPerUnit = meters / floor.width;
    mutate(p => { const target = p.floors.find(f => f.id === floor.id); if (target) target.metersPerUnit = metersPerUnit; }, 'Масштаб');
    setMessage(`Масштаб по листу ${sheetFormat} 1:${denominator}: ${number(metersPerUnit)} м/ед. PDF (${number(meters)} м по ширине листа). Проверьте контрольным размером.`);
  }
  function addRiser() {
    if (!route || !floor) return;
    const other = project.floors.find(f => f.id !== floor.id);
    if (!other) { setError('Для стояка сначала добавьте ещё один этаж.'); return; }
    const previous = route.segments[route.segments.length - 1]?.b;
    const a: Vertex = previous ? clone(previous) : { id: uid(), floorId: floor.id, x: 100, y: 100, height: 2.5 };
    const b: Vertex = { ...a, id: uid(), floorId: other.id };
    mutate(p => p.routes.find(r => r.id === route.id)!.segments.push({ id: uid(), a, b, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 }), 'Стояк');
    setMessage('Стояк добавлен. Уточните целевой этаж, x/y и высоты в свойствах сегмента.');
  }
  function segmentField(segment: Segment, endpoint: 'a' | 'b', key: keyof Vertex, value: unknown) {
    if (!route) return;
    mutate(p => { const target = p.routes.find(r => r.id === route.id)!.segments.find(s => s.id === segment.id)!; Object.assign(target[endpoint], { [key]: value }); }, 'Правка сегмента');
  }

  async function uploadPdf(file: File) {
    if (!floor) return;
    if (staticMode) {
      const key = uid();
      await idbPut(key, file);
      mutate(p => { const target = p.floors.find(f => f.id === floor.id)!; target.pdfId = 'idb:' + key; target.page = 1; target.metersPerUnit = null; });
      setMessage(`PDF «${file.name}» загружен. Выберите страницу и откалибруйте масштаб.`);
      return;
    }
    const data = new FormData(); data.append('file', file);
    const result = await api<{ id: string; name: string }>('/api/pdfs', { method: 'POST', body: data });
    mutate(p => { const target = p.floors.find(f => f.id === floor.id)!; target.pdfId = result.id; target.page = 1; target.metersPerUnit = null; });
    setMessage(`PDF «${result.name}» загружен. Выберите страницу и откалибруйте масштаб.`);
  }
  function togglePrintSection(id: JournalSectionId) {
    setPrintSections(items => {
      const next = new Set(items);
      if (next.has(id)) next.delete(id); else next.add(id);
      return JOURNAL_SECTIONS.map(section => section.id).filter(sectionId => next.has(sectionId));
    });
  }
  return {
    copyObject, removeObject, removeMany, moveMany, copySelection, removeSelection,
    addPhoto, removePhoto, setItem,
    applySheetScale, addRiser, segmentField, uploadPdf, togglePrintSection,
  };
}
