import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point, Project } from '../model';
import type { JournalSectionId } from '../export-pdf';
import type { DiagnosticEntry } from '../diagnostics';
import { logDiagnostic } from '../diagnostics';
import { cableSection, calculateCable, domainWarnings, trayFill, validateProject } from '../engine';
import { collectStorageGarbage } from '../garbage-collector';
import { migrateProject } from '../migrations';
import { usePdfBackground } from '../use-pdf-background';
import { usePhotoUrls } from '../use-photo-urls';
import { useProjectHistory } from '../use-project-history';
import { useSnapshots } from '../use-snapshots';
import { JOURNAL_SECTIONS } from './constants';
import { freshProject } from './project-factory';
import type { MultiSelection, Selection, SheetTarget, StructureTab, Tool, View } from './types';

/**
 * Состояние и производные значения рабочего пространства: проект, выбор,
 * инструмент, вид, история, PDF-подложка, снимки и фотографии.
 */
export function useWorkspaceState() {
  const [project, setProject] = useState<Project>(freshProject);
  const [floorId, setFloorId] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const [multi, setMulti] = useState<MultiSelection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<View>('plan');
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [propsOpen, setPropsOpen] = useState(false);
  const [tab, setTab] = useState<StructureTab>('floors');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(.8);
  const [pan, setPan] = useState({ x: 35, y: 35 });
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [ortho, setOrtho] = useState(true);
  const [gridSize, setGridSize] = useState(10);
  const [draft, setDraft] = useState<Point[]>([]);
  const [calibration, setCalibration] = useState<Point[]>([]);
  const [measure, setMeasure] = useState<Point[]>([]);
  const [measureMode, setMeasureMode] = useState<'length' | 'area'>('length');
  const [sheetFormat, setSheetFormat] = useState('A1');
  const [sheetScale, setSheetScale] = useState('100');
  const [cableSegments, setCableSegments] = useState<string[]>([]);
  const [cableFrom, setCableFrom] = useState('');
  const [cableTo, setCableTo] = useState('');
  const [routeHeight, setRouteHeight] = useState('2.5');
  const [message, setMessage] = useState('Готово. Загрузите PDF или откройте учебный проект.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [persisted, setPersisted] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: string }[] | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [staticMode, setStaticMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget>(null);
  // Выбранные для печати разделы; по умолчанию — все.
  const [printSections, setPrintSections] = useState<JournalSectionId[]>(() => JOURNAL_SECTIONS.map(section => section.id));
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  const drag = useRef<{ type: 'pan' | 'equipment' | 'vertex' | 'pinch'; id?: string; vertexId?: string; start: Point; pan: Point; before: Project; startDist?: number; startZoom?: number; startPan?: Point; startPdf?: Point } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const snapVibe = useRef(false);
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };
  const tap = useRef<{ pointerId: number; x: number; y: number; at: number; run: () => void } | null>(null);
  const pinching = useRef(false);
  const pressStart = useRef<Point | null>(null);
  const longPressTimer = useRef<number | null>(null);
  projectRef.current = project;
  const floor = project.floors.find(f => f.id === floorId) || project.floors[0];
  // Массовый выбор относится к одной вкладке: при переключении он сбрасывается.
  useEffect(() => { setMulti(current => (current && current.tab !== tab ? null : current)); }, [tab]);
  const dirty = JSON.stringify(project) !== saved;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const equipment = selection?.kind === 'equipment' ? project.equipment.find(e => e.id === selection.id) : undefined;
  const route = selection?.kind === 'route' ? project.routes.find(r => r.id === selection.id) : undefined;
  const cable = selection?.kind === 'cable' ? project.cables.find(c => c.id === selection.id) : undefined;
  const pin = selection?.kind === 'pin' ? project.pins.find(p => p.id === selection.id) : undefined;
  const dimension = selection?.kind === 'dimension' ? (project.dimensions ?? []).find(d => d.id === selection.id) : undefined;
  const photoOwner = equipment ?? pin;
  const cableSectionResult = cable ? cableSection(cable) : null;
  const calculation = cable ? calculateCable(project, cable) : null;
  const issues = useMemo(() => [...validateProject(project), ...domainWarnings(project)], [project]);
  const cableCalcs = useMemo(() => new Map(project.cables.map(c => [c.id, calculateCable(project, c)])), [project]);
  // Заполнение лотков тяжелее остальных расчётов, поэтому считается один раз на проект:
  // строки сегментов затем переиспользуются в свойствах трассы и кабеля.
  const fill = useMemo(() => trayFill(project), [project]);
  const cableFill = useMemo(() => {
    if (!cable) return null;
    const ids = new Set(cable.segmentIds);
    const rows = fill.segments.filter(row => ids.has(row.segmentId));
    const known = rows.filter(row => typeof row.fillPercent === 'number');
    if (!known.length) return { percent: null as number | null, status: null as string | null, unknown: rows.length };
    const worst = known.reduce((best, row) => ((row.fillPercent ?? 0) > (best.fillPercent ?? 0) ? row : best));
    return { percent: worst.fillPercent ?? null, status: worst.status as string | null, unknown: rows.length - known.length };
  }, [fill, cable]);
  const routeFillRows = route ? fill.segments.filter(row => row.routeId === route.id) : [];
  const routeFillKnown = routeFillRows.filter(row => typeof row.fillPercent === 'number');
  const routeFillWorst = routeFillKnown.length
    ? routeFillKnown.reduce((best, row) => ((row.fillPercent ?? 0) > (best.fillPercent ?? 0) ? row : best))
    : null;
  const totals = useMemo(() => {
    let meters = 0, metersComplete = true, cost = 0, costComplete = project.cables.length > 0;
    for (const cable of project.cables) {
      const calculation = calculateCable(project, cable);
      if (calculation.total === null) metersComplete = false; else meters += calculation.total * cable.quantity;
      if (calculation.cost === null) costComplete = false; else cost += calculation.cost;
    }
    return { meters, metersComplete, cost, costComplete };
  }, [project]);
  const issueCount = Array.isArray(issues) ? issues.length : 0;

  const { undo, redo, undoLabel, redoLabel, commit, mutate, history, reset: resetHistory, record: recordHistory } = useProjectHistory(projectRef, setProject, setError, () => {
    setSelection(null);
    setDraft([]);
  });
  const { pdfPages, renderPlan, pdfError, pdfNote } = usePdfBackground({
    floor, enabled: view === 'plan', viewRef, zoom, pan, canvas, stage, mutate,
  });
  const { historyOpen, setHistoryOpen, snapshots, setSnapshots, takeSnapshot, openHistory, restoreSnapshot, deleteSnapshot } = useSnapshots({
    projectRef, load, onGarbageCollect: () => void collectStorageGarbage([projectRef.current, ...undo, ...redo]), setError, setMessage,
  });
  const photoUrls = usePhotoUrls(photoOwner?.photos, photoOwner?.id);

  function load(value: unknown, exists: boolean) {
    let p: Project;
    try {
      p = migrateProject(value);
    } catch (error) {
      logDiagnostic('error', error, 'load');
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    setProject(p); projectRef.current = p; setSaved(exists ? JSON.stringify(p) : ''); setPersisted(exists);
    setFloorId(p.floors[0]?.id || ''); resetHistory(); setSelection(null); setMulti(null); setDraft([]); setMeasure([]); setCalibration([]); setCableSegments([]); setView('plan'); setTool('select'); setError('');
  }
  return {
    project, setProject, floorId, setFloorId, selection, setSelection, multi, setMulti, tool, setTool, view, setView,
    menuOpen, setMenuOpen, aboutOpen, setAboutOpen, diagnostics, setDiagnostics, propsOpen, setPropsOpen,
    tab, setTab, search, setSearch, zoom, setZoom, pan, setPan, grid, setGrid, snap, setSnap, ortho, setOrtho, gridSize, setGridSize,
    draft, setDraft, calibration, setCalibration, measure, setMeasure, measureMode, setMeasureMode,
    sheetFormat, setSheetFormat, sheetScale, setSheetScale, cableSegments, setCableSegments,
    cableFrom, setCableFrom, cableTo, setCableTo, routeHeight, setRouteHeight,
    message, setMessage, error, setError, busy, setBusy, saved, setSaved, persisted, setPersisted,
    projects, setProjects, pointer, setPointer, staticMode, setStaticMode, exportOpen, setExportOpen,
    sheet, setSheet, printSections, setPrintSections,
    canvas, stage, upload, restoreInput, photoInput, cameraInput,
    drag, pointers, snapVibe, tap, pinching, pressStart, longPressTimer,
    projectRef, floor, dirty, dirtyRef, equipment, route, cable, pin, dimension, photoOwner,
    cableSectionResult, calculation, issues, cableCalcs, fill, cableFill, routeFillWorst, totals, issueCount,
    undo, redo, undoLabel, redoLabel, commit, mutate, history, resetHistory, recordHistory,
    pdfPages, renderPlan, pdfError, pdfNote,
    historyOpen, setHistoryOpen, snapshots, setSnapshots, takeSnapshot, openHistory, restoreSnapshot, deleteSnapshot,
    photoUrls, load,
  };
}
export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
