import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Project, Floor, Equipment, Route, Cable, Segment, Vertex, Point, Pin, PriceItem, PriceKind } from './model';
import { calculateCable, cableSection, trayFill, specifications, validateProject, domainWarnings, chainEnds, findRoute } from './engine';
import { createDemoProject } from './demo';
import { exportSheets } from './sheets';
import { orphanPhotoKeys, purgePhotoBlobs } from './photos';
import { AboutSheet, APP_VERSION } from './About';
import { PlanAccessibilityList } from './PlanAccessibilityList';
import { PinProperties } from './PinProperties';
import { collectPhotos, collectPinPhotos, collectPlans } from './plan-capture';
import { clientCsv } from './client-csv';
import { collectStorageGarbage } from './garbage-collector';
import { compressPhoto } from './photo-compress';
import { clearDiagnostics, diagnosticsText, logDiagnostic, readDiagnostics, type DiagnosticEntry } from './diagnostics';
import { unusedStorageKeys } from './storage-gc';
import { migrateProject } from './migrations';
import { idbDelete, idbGet, idbPut, idbStoreDelete, idbStoreGet, idbStoreGetAll, idbStoreKeys, idbStorePut } from './idb';
import { deleteLocalProject, readLocalProjects, saveLocalProject } from './local-projects';
import { createUuid as uid, cloneValue as clone, loadBitmap } from './compat';
import { useProjectHistory } from './use-project-history';
import { usePdfBackground } from './use-pdf-background';
import { useSnapshots, type SnapshotEntry } from './use-snapshots';
import { usePhotoUrls } from './use-photo-urls';
import { EQUIPMENT_COLOR_PRESETS, EQUIPMENT_ICON_GLYPHS, equipmentColor, equipmentIcon, equipmentIconLabel } from './equipment-icons';
import { estimate, isCatalogDate, normalizeCatalog } from './estimate';

const SNAP_PX = 12;
const SHEET_SIZES: Record<string, { landscape: number; portrait: number }> = {
  A4: { landscape: 297, portrait: 210 },
  A3: { landscape: 420, portrait: 297 },
  A2: { landscape: 594, portrait: 420 },
  A1: { landscape: 841, portrait: 594 },
  A0: { landscape: 1189, portrait: 841 },
};
const CABLE_SNAP_LIMIT = 100;
type Selection = { kind: 'equipment' | 'route' | 'cable' | 'pin'; id: string } | null;
type Tool = 'select' | 'pan' | 'equipment' | 'route' | 'calibrate' | 'cable' | 'measure' | 'pin';
type View = 'plan' | 'journal' | 'specs' | 'estimate';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '—';
// Статусы заполнения приходят из движка английскими ключами — в интерфейсе показываем по-русски.
const FILL_STATUS_LABELS: Record<string, string> = { ok: 'ок', warning: 'внимание', over: 'превышено', empty: 'пусто', incomplete: 'неполный' };
const fillStatus = (status: string | null | undefined): string => (status ? FILL_STATUS_LABELS[status] ?? status : '');
const fillPercentText = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? `${number(value)} %` : 'не рассчитано';
const trayFillText = (value: number | null | undefined, status?: string | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'не рассчитано';
  const suffix = fillStatus(status);
  return `${number(value)} %${suffix ? ` · ${suffix}` : ''}`;
};
const areaMm2Text = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? `${number(value)} мм²` : 'не рассчитано';
const freshFloor = (name = 'Этаж 1'): Floor => ({ id: uid(), name, elevation: null, metersPerUnit: null, page: 1, width: 1000, height: 700 });
const freshProject = (): Project => ({ schemaVersion: 2, id: uid(), name: 'Новый проект', floors: [freshFloor()], equipment: [], routes: [], cables: [], pins: [], updatedAt: new Date().toISOString() });
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) { const text = await response.text(); throw new Error(text || `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}
const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
// Нативная оболочка Android (AnOOPlan) подключает мост AnOOPlanNative:
// через него экспортированные файлы попадают в «Загрузки/AnOOPlan».
type NativeBridgeApi = {
  platform?: () => string;
  saveFile?: (name: string, base64: string, mime: string) => string;
  setDirty?: (dirty: boolean) => void;
  exitNow?: () => void;
  vibrate?: (milliseconds: number) => void;
  printPdf?: (name: string, base64: string) => void;
};
const nativeBridge = (): NativeBridgeApi | null => (window as unknown as { AnOOPlanNative?: NativeBridgeApi }).AnOOPlanNative ?? null;
const isNativeApp = (): boolean => typeof nativeBridge()?.saveFile === 'function';
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
async function saveBlobOnDevice(name: string, blob: Blob): Promise<string | null> {
  const bridge = nativeBridge();
  if (typeof bridge?.saveFile !== 'function') return null;
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  const result = bridge.saveFile(name, base64, blob.type || 'application/octet-stream');
  if (result.startsWith('ok:')) return result.slice(3);
  throw new Error(result.replace(/^err:\s*/, '') || 'Не удалось сохранить файл на устройстве');
}

const vibrate = (milliseconds = 12): void => { nativeBridge()?.vibrate?.(milliseconds); };

// Числовое поле: принимает и точку, и запятую (русская раскладка) и не теряет ввод.
function NumberField({ value, onCommit, placeholder, ariaLabel }: {
  value: number | null;
  onCommit: (raw: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const format = (input: number | null): string => (input === null || input === undefined || !Number.isFinite(input) ? '' : String(input));
  const [text, setText] = useState<string>(() => format(value));
  const external = useRef<number | null>(value);
  useEffect(() => {
    if (external.current !== value) { external.current = value; setText(format(value)); }
  }, [value]);
  return <input
    type="text"
    inputMode="decimal"
    autoComplete="off"
    spellCheck={false}
    aria-label={ariaLabel}
    placeholder={placeholder}
    value={text}
    onChange={event => {
      const raw = event.target.value;
      setText(raw);
      const normalized = raw.replace(/,/g, '.').replace(/\s+/g, '');
      if (normalized === '') { external.current = null; onCommit(''); return; }
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) { external.current = parsed; onCommit(normalized); }
    }}
    onBlur={() => setText(format(value))}
  />;
}

export default function App() {
  const [project, setProject] = useState<Project>(freshProject);
  const [floorId, setFloorId] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<View>('plan');
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [propsOpen, setPropsOpen] = useState(false);
  const [tab, setTab] = useState<'floors' | 'equipment' | 'routes' | 'cables' | 'pins'>('floors');
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
  const [sheet, setSheet] = useState<{ kind: 'equipment' | 'route' | 'cable' | 'pin'; id: string } | null>(null);
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
  const dirty = JSON.stringify(project) !== saved;
  const equipment = selection?.kind === 'equipment' ? project.equipment.find(e => e.id === selection.id) : undefined;
  const route = selection?.kind === 'route' ? project.routes.find(r => r.id === selection.id) : undefined;
  const cable = selection?.kind === 'cable' ? project.cables.find(c => c.id === selection.id) : undefined;
  const pin = selection?.kind === 'pin' ? project.pins.find(p => p.id === selection.id) : undefined;
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

  const { undo, redo, commit, mutate, history, reset: resetHistory, record: recordHistory } = useProjectHistory(projectRef, setProject, setError, () => {
    setSelection(null);
    setDraft([]);
  });
  const { pdfPages, renderPlan, pdfError } = usePdfBackground({
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
    setFloorId(p.floors[0]?.id || ''); resetHistory(); setSelection(null); setDraft([]); setMeasure([]); setCalibration([]); setCableSegments([]); setView('plan'); setTool('select'); setError('');
  }
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { logDiagnostic('error', e, 'run'); setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function saveProject(silent = false): Promise<Project> {
    const snapshot = clone(projectRef.current);
    if (staticMode) {
      saveLocalProject(snapshot); setPersisted(true); setSaved(JSON.stringify(snapshot));
      if (!silent) {
        setMessage(`Проект «${snapshot.name}» сохранён в браузере`);
        void takeSnapshot('ручное сохранение').catch(() => { /* история недоступна */ });
      }
      return snapshot;
    }
    const result = await api<Project>(persisted ? `/api/projects/${snapshot.id}` : '/api/projects', jsonOptions(persisted ? 'PUT' : 'POST', snapshot));
    setPersisted(true); setSaved(JSON.stringify(result));
    if (JSON.stringify(projectRef.current) === JSON.stringify(snapshot)) { setProject(result); projectRef.current = result; }
    if (!silent) setMessage(`Проект «${result.name}» сохранён`);
    return result;
  }
  async function deleteProject(id: string, name: string) {
    if (!window.confirm(`Удалить проект «${name}»? Это действие необратимо.`)) return;
    if (staticMode) {
      // Снимки принадлежат проекту: без их удаления блобы PDF/фото останутся сиротами.
      try {
        const snapshotKeys = (await idbStoreKeys('snapshots')).filter(key => key.startsWith(id + ':'));
        for (const key of snapshotKeys) { try { await idbStoreDelete('snapshots', key); } catch { /* хранилище недоступно */ } }
      } catch { /* хранилище недоступно — проект всё равно удаляем */ }
      const target = readLocalProjects().find(p => p.id === id);
      if (target) for (const f of target.floors) if (f.pdfId?.startsWith('idb:')) { try { await idbDelete(f.pdfId.slice(4)); } catch { /* хранилище недоступно */ } }
      if (target) for (const item of [...target.equipment, ...(target.pins ?? [])]) for (const key of item.photos || []) { try { await idbDelete('photo:' + key); } catch { /* хранилище недоступно */ } }
      deleteLocalProject(id);
    } else await api('/api/projects/' + id, { method: 'DELETE' });
    setProjects(list => list ? list.filter(p => p.id !== id) : null);
    setMessage(`Проект «${name}» удалён.`);
  }
  function mayLeave() { return !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }
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
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  useEffect(() => { setDraft([]); setCalibration([]); setMeasure([]); }, [floor?.id, floor?.pdfId]);
  useEffect(() => { fetch('/api/health').then(r => { if (!r.ok) setStaticMode(true); }).catch(() => setStaticMode(true)); }, []);
  useEffect(() => {
    if (!staticMode) return;
    const timer = setTimeout(() => { try { localStorage.setItem('cableplan:autosave', JSON.stringify(projectRef.current)); } catch { /* переполнение localStorage */ } }, 800);
    return () => clearTimeout(timer);
  }, [project, staticMode]);
  // Проект, который уже лежит в списке, дописывается сам — «Сохранить» лишь для нового.
  useEffect(() => {
    if (!dirty || !persisted) return;
    const timer = setTimeout(() => { void saveProject(true).catch(error => { logDiagnostic('error', error, 'autosave'); /* повторим при следующем изменении */ }); }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, project]);
  // Снимок версии: раз в пять минут при несохранённых изменениях и перед восстановлением.
  useEffect(() => {
    const timer = setInterval(() => { if (dirty) void takeSnapshot('автоснимок').catch(() => { /* хранилище недоступно */ }); }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [dirty]);
  // Фоновая уборка осиротевших PDF/фото. Учитывает историю и снимки, поэтому
  // не ломает undo; запускается после затишья, чтобы не мешать правкам.
  useEffect(() => {
    if (!staticMode) return;
    const timer = setTimeout(() => { void collectStorageGarbage([projectRef.current, ...undo, ...redo]); }, 3000);
    return () => clearTimeout(timer);
  }, [project, undo, redo, staticMode]);
  // Нативная оболочка спрашивает, есть ли несохранённые изменения (кнопка/жест «Назад»).
  useEffect(() => { nativeBridge()?.setDirty?.(dirty); }, [dirty]);
  // Вызывается из Java: сохранить и только потом закрыть приложение.
  useEffect(() => {
    (window as Window & { __anooplanSaveAndExit?: () => Promise<void> }).__anooplanSaveAndExit = async () => {
      try { await saveProject(true); } catch (error) { logDiagnostic('error', error, 'saveAndExit'); /* выходим в любом случае */ }
      nativeBridge()?.exitNow?.();
    };
  });
  useEffect(() => {
    if (!staticMode) return;
    try {
      const raw = localStorage.getItem('cableplan:autosave');
      if (!raw) return;
      const saved = JSON.parse(raw) as Project;
      if (saved && (saved.schemaVersion === 1 || saved.schemaVersion === 2) && Array.isArray(saved.floors) && projectRef.current.name === 'Новый проект' && projectRef.current.equipment.length === 0) {
        load(saved, true); setMessage('Восстановлен последний черновик из браузера.');
      }
    } catch { /* ignore */ }
  }, [staticMode]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void run(async () => { await saveProject(); }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(!e.shiftKey); }
      if (e.key === 'Escape') { setDraft([]); setCalibration([]); setCableSegments([]); setMeasure([]); setTool('select'); }
      if (e.key === 'Enter' && draft.length > 1) finishRoute();
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
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
      setMessage(`Площадь: ${areaLabel(next)} по контуру из ${next.length} точек.`);
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
  function polygonArea(points: Point[]): number {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index], b = points[(index + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }
  function areaLabel(points: Point[]): string {
    const units = polygonArea(points);
    const scale = floor?.metersPerUnit;
    return scale && scale > 0 ? `${number(units * scale * scale)} м²` : `${number(units)} ед.²`;
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
      id: uid(), number: nextPinNumber(), floorId: floor.id, x: point.x, y: point.y,
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
  type ObjectKind = 'equipment' | 'route' | 'cable' | 'pin';
  function uniqueNumber(base: string, used: Set<string>): string {
    let candidate = `${base}-копия`;
    let index = 2;
    while (used.has(candidate)) candidate = `${base}-копия ${index++}`;
    return candidate;
  }
  function nextPinNumber(): string {
    const used = new Set(projectRef.current.pins.map(item => item.number));
    let number = projectRef.current.pins.length + 1;
    while (used.has(`З-${number}`)) number += 1;
    return `З-${number}`;
  }
  function copyObject(kind: ObjectKind, id: string) {
    const source = projectRef.current;
    if (kind === 'equipment') {
      const item = source.equipment.find(e => e.id === id); if (!item) return;
      const used = new Set(source.equipment.map(e => e.number));
      const next: Equipment = { ...clone(item), id: uid(), number: uniqueNumber(item.number, used), x: item.x + gridSize, y: item.y + gridSize, photos: [] };
      mutate(p => p.equipment.push(next)); setSelection({ kind: 'equipment', id: next.id }); setMessage(`Копия оборудования: ${next.number}.`);
      return;
    }
    if (kind === 'pin') {
      const item = source.pins.find(pin => pin.id === id); if (!item) return;
      const next: Pin = { ...clone(item), id: uid(), number: nextPinNumber(), x: item.x + gridSize, y: item.y + gridSize, photos: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      mutate(p => p.pins.push(next)); setSelection({ kind: 'pin', id: next.id }); setTab('pins'); setMessage(`Копия замечания: ${next.number}.`);
      return;
    }
    if (kind === 'route') {
      const item = source.routes.find(r => r.id === id); if (!item) return;
      const used = new Set(source.routes.map(r => r.number));
      const next = clone(item);
      next.id = uid(); next.number = uniqueNumber(item.number, used);
      const vertexIds = new Map<string, string>();
      next.segments.forEach(segment => { segment.id = uid(); [segment.a, segment.b].forEach(vertex => { if (!vertexIds.has(vertex.id)) vertexIds.set(vertex.id, uid()); vertex.id = vertexIds.get(vertex.id)!; vertex.x += gridSize; vertex.y += gridSize; }); });
      mutate(p => p.routes.push(next)); setSelection({ kind: 'route', id: next.id }); setMessage(`Копия трассы: ${next.number}.`);
      return;
    }
    const item = source.cables.find(c => c.id === id); if (!item) return;
    const used = new Set(source.cables.map(c => c.number));
    const next: Cable = { ...clone(item), id: uid(), number: uniqueNumber(item.number, used) };
    mutate(p => p.cables.push(next)); setSelection({ kind: 'cable', id: next.id }); setMessage(`Копия кабеля: ${next.number}.`);
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
    });
    void purgePhotoBlobs(photoKeys, idbDelete);
    setSelection(null); setSheet(null); setPropsOpen(false);
  }
  function copySelection() { if (selection) copyObject(selection.kind, selection.id); }
  function removeSelection() { if (selection) removeObject(selection.kind, selection.id); }
  function openObjectSheet(kind: ObjectKind, id: string) {
    cancelLongPress();
    setSelection({ kind, id });
    setSheet({ kind, id });
    setPropsOpen(false);
    vibrate(18);
  }
  function measureLabel(): string {
    if (measureMode === 'area') return measure.length >= 3 ? areaLabel(measure) : '';
    if (measure.length < 2) return '';
    const units = Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y);
    const scale = floor?.metersPerUnit;
    return scale && scale > 0 ? `${number(units * scale)} м` : `${number(units)} ед.`;
  }
  function sheetTitle(value: { kind: ObjectKind; id: string }) {
    const label = value.kind === 'equipment' ? 'Оборудование' : value.kind === 'route' ? 'Трасса' : value.kind === 'pin' ? 'Замечание' : 'Кабель';
    const item = value.kind === 'equipment' ? project.equipment.find(e => e.id === value.id) : value.kind === 'route' ? project.routes.find(r => r.id === value.id) : value.kind === 'pin' ? project.pins.find(pin => pin.id === value.id) : project.cables.find(c => c.id === value.id);
    return item ? `${label} ${item.number}` : label;
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
    mutate(p => { const collection = selection.kind === 'equipment' ? p.equipment : selection.kind === 'route' ? p.routes : p.cables; const item = collection.find(i => i.id === selection.id); if (item) Object.assign(item, { [key]: value }); });
  }
  function field(label: string, value: string | number | null, change: (value: string) => void, numeric = false, hint?: string) {
    if (numeric) {
      const current = typeof value === 'number' && Number.isFinite(value) ? value : null;
      return <label className="field">{label}<NumberField value={current} placeholder="Не задано" onCommit={change} />{hint && <small>{hint}</small>}</label>;
    }
    return <label className="field">{label}<input type="text" value={value ?? ''} onChange={e => change(e.target.value)} />{hint && <small>{hint}</small>}</label>;
  }
  function itemField(label: string, key: string, numeric = false) {
    const item = equipment || route || cable;
    const val = item ? (item as unknown as Record<string, string | number | null>)[key] : '';
    return field(label, val ?? '', value => setItem(key, numeric ? (value === '' ? null : Number(value)) : value), numeric);
  }
  function floorSelect(value: string, change: (id: string) => void) { return <select value={value} onChange={e => change(e.target.value)}>{project.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>; }
  function equipmentSelect(value: string, change: (id: string) => void) { return <select value={value} onChange={e => change(e.target.value)}><option value="">Выберите оборудование</option>{project.equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.number} · {eq.name}</option>)}</select>; }
  function segmentName(id: string) { const owner = project.routes.find(r => r.segments.some(s => s.id === id)); const index = owner?.segments.findIndex(s => s.id === id); return owner ? `${owner.number} / ${(index ?? 0) + 1}` : `Отсутствует: ${id.slice(0, 8)}`; }
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
    mutate(p => { const target = p.floors.find(f => f.id === floor.id); if (target) target.metersPerUnit = metersPerUnit; });
    setMessage(`Масштаб по листу ${sheetFormat} 1:${denominator}: ${number(metersPerUnit)} м/ед. PDF (${number(meters)} м по ширине листа). Проверьте контрольным размером.`);
  }
  function addRiser() {
    if (!route || !floor) return;
    const other = project.floors.find(f => f.id !== floor.id);
    if (!other) { setError('Для стояка сначала добавьте ещё один этаж.'); return; }
    const previous = route.segments[route.segments.length - 1]?.b;
    const a: Vertex = previous ? clone(previous) : { id: uid(), floorId: floor.id, x: 100, y: 100, height: 2.5 };
    const b: Vertex = { ...a, id: uid(), floorId: other.id };
    mutate(p => p.routes.find(r => r.id === route.id)!.segments.push({ id: uid(), a, b, mode: 'orthogonal', reservePercent: 0, reserveFixed: 0 }));
    setMessage('Стояк добавлен. Уточните целевой этаж, x/y и высоты в свойствах сегмента.');
  }
  function segmentField(segment: Segment, endpoint: 'a' | 'b', key: keyof Vertex, value: unknown) {
    if (!route) return;
    mutate(p => { const target = p.routes.find(r => r.id === route.id)!.segments.find(s => s.id === segment.id)!; Object.assign(target[endpoint], { [key]: value }); });
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
  async function printJournal() {
    const current = projectRef.current;
    const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('./export-pdf'), import('./export-fonts')]);
    const plans = await collectPlans(current, (done, total) => { if (total > 1) setMessage(`Планы: ${done} из ${total}…`); });
    const bytes = await buildJournalPdf(current, await loadJournalFonts(), { photos: await collectPhotos(current), pinPhotos: await collectPinPhotos(current), plans: plans.plans });
    nativeBridge()?.printPdf?.(current.name, bytesToBase64(bytes));
    setMessage(`Открыт системный диалог печати: выберите принтер или «Сохранить в PDF».${plans.warnings.length ? ` ${plans.warnings.join(' ')}` : ''}`);
  }
  async function download(kind: 'csv' | 'xlsx' | 'pdf' | 'backup') {
    if (staticMode) {
      const current = projectRef.current;
      const fileName = `${current.name}.${kind === 'backup' ? 'json' : kind}`;
      let blob: Blob;
      let planWarnings: string[] = [];
      if (kind === 'xlsx') {
        // Офлайн-таблицы: тот же набор листов, что отдаёт серверная версия.
        const { buildWorkbook } = await import('./export-xlsx');
        blob = new Blob([buildWorkbook(exportSheets(current)) as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else if (kind === 'pdf') {
        // Офлайн-PDF: pdf-lib + встроенный PT Sans, без сервера и системных шрифтов.
        const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('./export-pdf'), import('./export-fonts')]);
        const plans = await collectPlans(current, (done, total) => { if (total > 1) setMessage(`Планы: ${done} из ${total}…`); });
        planWarnings = plans.warnings;
        blob = new Blob([await buildJournalPdf(current, await loadJournalFonts(), { photos: await collectPhotos(current), pinPhotos: await collectPinPhotos(current), plans: plans.plans }) as unknown as BlobPart], { type: 'application/pdf' });
      } else if (kind === 'backup') {
        const ids = [...new Set(current.floors.flatMap(f => f.pdfId && f.pdfId.startsWith('idb:') ? [f.pdfId.slice(4)] : []))];
        const pdfs: { id: string; name: string; dataBase64: string }[] = [];
        for (const id of ids) {
          const pdfBlob = await idbGet(id);
          if (pdfBlob) pdfs.push({ id: 'idb:' + id, name: 'plan.pdf', dataBase64: await blobToBase64(pdfBlob) });
        }
        const photoKeys = [...new Set([...current.equipment, ...current.pins].flatMap(item => item.photos || []))];
        const photos: { key: string; name: string; mime: string; dataBase64: string }[] = [];
        for (const key of photoKeys) {
          try {
            const photoBlob = await idbGet('photo:' + key);
            if (photoBlob) photos.push({ key, name: 'photo.jpg', mime: photoBlob.type || 'image/jpeg', dataBase64: await blobToBase64(photoBlob) });
          } catch { /* фото недоступно — копия всё равно выгружается */ }
        }
        blob = new Blob([JSON.stringify({ schemaVersion: 2, project: current, pdfs, photos })], { type: 'application/json' });
      } else {
        blob = new Blob([clientCsv(current)], { type: 'text/csv;charset=utf-8' });
      }
      const done: Record<string, string> = {
        csv: 'Экспорт CSV сохранён',
        xlsx: 'Таблицы Excel сохранены',
        pdf: 'Журнал PDF сохранён',
        backup: 'Резервная копия сохранена',
      };
      const warning = planWarnings.length ? ` ${planWarnings.join(' ')}` : '';
      const savedPath = await saveBlobOnDevice(fileName, blob);
      if (savedPath) {
        setMessage(`${done[kind]}: ${savedPath}${warning}`);
        return;
      }
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage(`${done[kind].replace('сохранён', 'готов').replace('сохранены', 'готовы')}.${warning}`);
      return;
    }
    const current = await saveProject();
    const url = kind === 'backup' ? `/api/projects/${current.id}/backup` : `/api/projects/${current.id}/export?format=${kind}`;
    const response = await fetch(url); if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${current.name}.${kind === 'backup' ? 'json' : kind}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setMessage(kind === 'backup' ? 'Резервная копия с PDF выгружена.' : `Экспорт ${kind.toUpperCase()} готов.`);
  }
  async function restoreProjectFile(file: File): Promise<void> {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (staticMode) {
      const hasProject = Boolean(parsed) && typeof parsed === 'object' && 'project' in parsed;
      const project = migrateProject(hasProject ? parsed.project : parsed);
      if (hasProject) {
        const rawPdfs = Array.isArray(parsed.pdfs) ? parsed.pdfs as { id?: string; dataBase64?: string }[] : [];
        for (const pdf of rawPdfs) {
          if (pdf?.id && pdf.dataBase64) {
            const bytes = Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0));
            await idbPut(pdf.id.replace(/^idb:/, ''), new Blob([bytes], { type: 'application/pdf' }));
          }
        }
        const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos as { key?: string; dataBase64?: string; mime?: string }[] : [];
        for (const photo of rawPhotos) {
          if (photo?.key && photo.dataBase64) {
            const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0));
            await idbPut('photo:' + photo.key, new Blob([bytes], { type: photo.mime || 'image/jpeg' }));
          }
        }
      }
      load(project, true);
      setMessage('Проект загружен из файла.');
      return;
    }
    if (parsed && typeof parsed === 'object' && 'project' in parsed) {
      const result = await api<Project>('/api/restore', jsonOptions('POST', parsed));
      load(result, true);
      setMessage('Резервная копия с PDF восстановлена.');
      return;
    }
    load(parsed, false);
    setMessage('Проект загружен из файла. Подложку PDF при необходимости загрузите заново.');
  }

  async function exportDiagnostics(): Promise<void> {
    const blob = new Blob([diagnosticsText(APP_VERSION)], { type: 'text/plain;charset=utf-8' });
    const name = `AnOOPlan-диагностика-${new Date().toISOString().slice(0, 10)}.txt`;
    const savedPath = await saveBlobOnDevice(name, blob);
    if (!savedPath) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    setMessage(savedPath ? `Журнал диагностики сохранён: ${savedPath}` : 'Журнал диагностики сформирован.');
  }
  const toolHints: Record<Tool, string> = { select: 'Выберите объект • тяните оборудование и узлы трассы', pan: 'Перетаскивайте план • колесо — масштаб', equipment: 'Клик на плане — добавить оборудование', route: 'Клики — вершины • Enter — завершить • Esc — отменить', calibrate: 'Укажите две точки известного размера на PDF', cable: 'Выбирайте сегменты по порядку от начала к концу', measure: 'Рулетка: две точки на плане → расстояние в метрах', pin: 'Клик на плане — добавить замечание' };

  return <div className="app-shell">
    <header className="topbar"><button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen(v => !v)}>☰</button><div className="brand"><span className="brand-mark">A</span><div>AnOOPlan<small>кабельный план</small></div></div><div className="project-heading"><input aria-label="Название проекта" value={project.name} onChange={e => mutate(p => { p.name = e.target.value; })} /><span className={dirty ? 'save-indicator dirty' : 'save-indicator'}>{dirty ? '● Не сохранён' : '● Сохранён'}</span></div><div className="top-actions"><button className="desk-only" onClick={() => { if (mayLeave()) load(freshProject(), false); }}>Новый</button><button className="desk-only" disabled={busy} onClick={() => void run(async () => { setProjects(staticMode ? readLocalProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); })}>Открыть</button><button disabled={busy} title="Загрузить ранее экспортированный JSON-проект" onClick={() => restoreInput.current?.click()}>Загрузить</button><button className="primary" disabled={busy || (persisted && !dirty)} onClick={() => void run(async () => { await saveProject(); })}>{busy ? 'Подождите…' : persisted && !dirty ? 'Сохранено ✓' : 'Сохранить'}</button></div></header>
    <div className="commandbar"><div className="view-tabs">{([['plan', 'План'], ['journal', 'Журнал'], ['specs', 'Ведомости'], ['estimate', 'Смета']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><div className="command-actions"><button className="desk-only" onClick={() => { if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>Учебный проект</button><button className="export-trigger" onClick={() => setExportOpen(true)}>Экспорт / копия ↓</button></div></div>
    {error && <div className="banner error" role="alert"><strong>Не удалось выполнить действие.</strong> {error}<button onClick={() => setError('')}>×</button></div>}
    <div className="workspace"><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="sidebar-title">Структура проекта <span>{project.floors.length} эт.</span></div><div className="structure-tabs">{([['floors', 'Этажи'], ['equipment', 'Оборуд.'], ['routes', 'Трассы'], ['cables', 'Кабели'], ['pins', 'Зам.']] as const).map(([id, name]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{name}<span>{project[id].length}</span></button>)}</div>
      <div className="object-list" onPointerDown={listPressDown} onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}>{tab === 'floors' ? project.floors.map((f, i) => <button key={f.id} className={`object-row ${floor?.id === f.id ? 'selected' : ''}`} onClick={() => { setFloorId(f.id); setSelection(null); setMenuOpen(false); }}><span className="object-icon">{String(i + 1).padStart(2, '0')}</span><span><strong>{f.name}</strong><small>{f.pdfId ? `PDF · страница ${f.page}` : 'Без подложки'} · {f.elevation === null ? 'отметка не задана' : `${number(f.elevation)} м`}</small></span><i className={f.metersPerUnit ? 'dot calibrated' : 'dot'} /></button>) : tab === 'equipment' ? project.equipment.map(eq => <button key={eq.id} data-kind="equipment" data-id={eq.id} className={`object-row ${selection?.id === eq.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'equipment', id: eq.id }); setFloorId(eq.floorId); setView('plan'); setMenuOpen(false); }}><span className="object-icon equipment-icon"><EquipmentIcon item={eq} /></span><span><strong>{eq.number}</strong><small>{eq.name}</small></span></button>) : tab === 'routes' ? project.routes.map(r => <button key={r.id} data-kind="route" data-id={r.id} className={`object-row ${selection?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'route', id: r.id }); if (r.segments[0]) setFloorId(r.segments[0].a.floorId); setView('plan'); setMenuOpen(false); }}><span className="object-icon route-icon">⌁</span><span><strong>{r.number} · {r.type}</strong><small>{r.segments.length} сегм.</small></span></button>) : tab === 'pins' ? project.pins.map(pin => <button key={pin.id} data-kind="pin" data-id={pin.id} className={`object-row ${selection?.id === pin.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'pin', id: pin.id }); setFloorId(pin.floorId); setView('plan'); setMenuOpen(false); }}><span className="object-icon pin-icon">📍</span><span><strong>{pin.number}</strong><small>{pin.comment || 'Без текста'} · {pin.status === 'closed' ? 'закрыто' : 'открыто'}</small></span></button>) : project.cables.map(c => { const calc = cableCalcs.get(c.id)!; return <button key={c.id} data-kind="cable" data-id={c.id} className={`object-row ${selection?.id === c.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'cable', id: c.id }); setMenuOpen(false); }}><span className="object-icon cable-icon">↝</span><span><strong>{c.number} · {c.brand || c.name}</strong><small>{calc.complete ? `${number(calc.total)} м` : 'Неполный расчёт'}</small></span><i className={calc.complete ? 'dot calibrated' : 'dot warning'} /></button>; })}
      {project[tab].length === 0 && <div className="empty-list">Объектов пока нет.<br />Добавьте их на плане.</div>}</div>
      <div className="sidebar-actions">{tab === 'floors' ? <><button onClick={() => { const f = freshFloor(`Этаж ${project.floors.length + 1}`); mutate(p => p.floors.push(f)); setFloorId(f.id); setSelection(null); }}>＋ Добавить этаж</button><button onClick={() => upload.current?.click()} disabled={!floor || busy}>↑ Загрузить PDF</button></> : <button onClick={() => { setView('plan'); setTool(tab === 'equipment' ? 'equipment' : tab === 'routes' ? 'route' : tab === 'pins' ? 'pin' : 'cable'); }}>＋ {tab === 'equipment' ? 'Оборудование на плане' : tab === 'routes' ? 'Начертить трассу' : tab === 'pins' ? 'Замечание на плане' : 'Создать кабель'}</button>}</div>
      <div className="sidebar-project"><button onClick={() => { setMenuOpen(false); if (mayLeave()) load(freshProject(), false); }}>＋ Новый проект</button><button disabled={busy} onClick={() => { setMenuOpen(false); void run(async () => { setProjects(staticMode ? readLocalProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); }); }}>📂 Открыть проект</button><button disabled={busy} onClick={() => { setMenuOpen(false); restoreInput.current?.click(); }}>⬆ Загрузить JSON</button><button onClick={() => { setMenuOpen(false); if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>📘 Учебный проект</button></div>
      <div className="project-health"><span className="eyebrow">КОНТРОЛЬ ДАННЫХ</span><strong>{issueCount ? `${issueCount} замечаний` : 'Проверка проекта'}</strong><small>Неизвестные отметки, масштаб и разрывы исключают итоговый метраж.</small><button onClick={() => setView('specs')}>Показать проверку →</button></div>
      <div className="sidebar-about"><button onClick={() => { setMenuOpen(false); setDiagnostics(readDiagnostics()); setAboutOpen(true); }}>ℹ О программе / Лицензии</button></div></aside>
      <main className="main-area">{view === 'plan' ? <div className="plan-view"><div className="drawing-toolbar"><div className="tool-group">{([['select', '↖', 'Выбор'], ['pan', '✥', 'Панорама'], ['equipment', '▣', 'Оборудование'], ['route', '⌁', 'Трасса'], ['cable', '↝', 'Кабель'], ['calibrate', '↔', 'Масштаб'], ['measure', '📏', 'Рулетка']] as const).map(([id, icon, label]) => <button key={id} title={label} className={tool === id ? 'active' : ''} onClick={() => { setTool(id); setDraft([]); setCalibration([]); setMeasure([]); }}><b>{icon}</b><span>{label}</span></button>)}</div><div className="tool-group history"><button title="Отменить Ctrl+Z" aria-label="Отменить" disabled={!undo.length} onClick={() => history(true)}>↶</button><button title="Повторить Ctrl+Shift+Z" aria-label="Повторить" disabled={!redo.length} onClick={() => history(false)}>↷</button></div></div>
      <div className="drawing-options"><label><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />Сетка</label><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Привязка</label><label><input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} />Ортогонально</label><label>Шаг<input className="mini-input" type="number" min="1" value={gridSize} onChange={e => setGridSize(Math.max(1, Number(e.target.value) || 1))} /></label><span className="grow" />{floor?.pdfId && <label>Страница <input className="mini-input" type="number" min="1" max={pdfPages || 9999} value={floor.page} onChange={e => { const page = Math.max(1, Math.min(pdfPages || 9999, Number(e.target.value) || 1)); if (page !== floor.page && window.confirm('Смена страницы сохраняет объекты и сбрасывает масштаб. Продолжить?')) mutate(p => { const f = p.floors.find(f => f.id === floor.id)!; f.page = page; f.metersPerUnit = null; }); }} /> / {pdfPages || '…'}</label>}<button onClick={fit} aria-label="Вписать план">Вписать</button><button onClick={() => changeZoom(zoom / 1.2)} aria-label="Уменьшить масштаб">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => changeZoom(zoom * 1.2)} aria-label="Увеличить масштаб">＋</button><button className={tool === 'pin' ? 'active' : ''} title="Замечание" onClick={() => setTool(tool === 'pin' ? 'select' : 'pin')}>📍 Замечание</button></div>
      {tool === 'route' && <div className="contextbar"><span>Трасса: {draft.length} вершин</span><label>Высота, м <input type="text" inputMode="decimal" value={routeHeight} onChange={e => setRouteHeight(e.target.value.replace(',', '.'))} /></label><button className="primary" disabled={draft.length < 2} onClick={finishRoute}>Завершить · Enter</button><button onClick={() => setDraft([])}>Сбросить</button></div>}
      {tool === 'measure' && <div className="contextbar"><span>{measureMode === 'length' ? `Рулетка: точек ${Math.min(measure.length, 2)} из 2` : `Площадь: вершин ${measure.length}`}</span><button className={measureMode === 'length' ? 'primary' : ''} onClick={() => { setMeasureMode('length'); setMeasure([]); setMessage('Рулетка: укажите две точки на плане.'); }}>Длина</button><button className={measureMode === 'area' ? 'primary' : ''} onClick={() => { setMeasureMode('area'); setMeasure([]); setMessage('Площадь: обведите контур по вершинам, минимум три.'); }}>Площадь</button><button onClick={() => setMeasure([])}>Сброс</button><small>{floor?.metersPerUnit ? 'Метры по масштабу листа.' : 'Масштаб не задан — результат в единицах PDF.'}</small></div>}
      {tool === 'cable' && <div className="contextbar cable-builder"><label>От {equipmentSelect(cableFrom, setCableFrom)}</label><span>→</span><label>До {equipmentSelect(cableTo, setCableTo)}</label><button onClick={() => { if (!cableFrom || !cableTo) { setError('Сначала выберите «От» и «До».'); return; } const res = findRoute(project, cableFrom, cableTo); if (res.error) setError(res.error); else { setCableSegments(res.segmentIds); setMessage(`Маршрут построен: ${res.segmentIds.length} сегм.`); } }}>Автомаршрут</button><span>{cableSegments.length} сегм.</span><button className="primary" onClick={finishCable}>Создать</button><button onClick={() => setCableSegments([])}>Сброс</button><small>Выберите «От» и «До» — маршрут строится сам. Можно скорректировать сегменты кликами.</small></div>}
      {pdfError && <div className="banner error">{pdfError}</div>}
      <div className={`drawing-stage tool-${tool}`} ref={stage}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}
        onPointerDownCapture={stagePressDown} onPointerMoveCapture={moveLongPress} onPointerUpCapture={cancelLongPress}
        onWheel={e => { e.preventDefault(); changeZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }}
        onDoubleClick={e => { if ((e.target as Element).closest('[data-object]')) return; e.preventDefault(); if (zoom < 1.5) zoomAt(e.clientX, e.clientY, zoom * 2.4); else fit(); }}>
        {floor && <div className="drawing-sheet" style={{ width: floor.width, height: floor.height, transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          {floor.pdfId ? <canvas ref={canvas} aria-label={`План: ${floor?.name ?? 'этаж'}`} style={renderPlan ? { position: 'absolute', left: renderPlan.clipX, top: renderPlan.clipY, width: renderPlan.clipWidth, height: renderPlan.clipHeight } : { width: '100%', height: '100%' }} /> : <div className="no-pdf"><span>AnOOPlan / {floor.name.toUpperCase()}</span><p>Рабочее поле без PDF</p><small>{project.name.includes('Учеб') ? 'Синтетическая схема для проверки расчёта' : 'Загрузите план PDF и задайте масштаб по двум точкам'}</small></div>}
          <svg className="plan-overlay" width={floor.width} height={floor.height} viewBox={`0 0 ${floor.width} ${floor.height}`}>
            <defs><pattern id="drawing-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#63828e" strokeOpacity=".19" strokeWidth={.5 / zoom} /></pattern></defs>
            {grid && <rect width="100%" height="100%" fill="url(#drawing-grid)" pointerEvents="none" />}
            {project.routes.flatMap(r => r.segments.map((s, index) => {
              const visibleA = s.a.floorId === floor.id, visibleB = s.b.floorId === floor.id; if (!visibleA && !visibleB) return null;
              const chosen = cableSegments.includes(s.id) || cable?.segmentIds.includes(s.id); const selected = selection?.id === r.id;
              return <g key={s.id} data-object="segment" data-id={s.id} data-route={r.id} className={`route-segment ${chosen ? 'cable-selected' : ''} ${selected ? 'is-selected' : ''}`} onPointerDown={e => { e.stopPropagation(); if (pinching.current) return; if (tool === 'cable') armTap(e, () => setCableSegments(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])); else if (tool === 'route') armTap(e, () => { const p = position(e); setDraft(points => [...points, p]); }); else if (tool === 'select') armTap(e, () => setSelection({ kind: 'route', id: r.id })); }}>
                <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="transparent" strokeWidth={26 / zoom} />
                <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} strokeWidth={(chosen ? 5 : selected ? 4 : 3) / zoom} className="visible-route" pointerEvents="none" strokeDasharray={!visibleA || !visibleB ? `${7 / zoom} ${4 / zoom}` : undefined} />
                {(!visibleA || !visibleB) && <g transform={`translate(${s.a.x},${s.a.y})`}><circle r={9 / zoom} fill="white" stroke="#875ec5" strokeWidth={2 / zoom} /><text textAnchor="middle" y={4 / zoom} fontSize={12 / zoom} fill="#875ec5">↕</text></g>}
                {(selected || chosen) && <text x={(s.a.x + s.b.x) / 2 + 6 / zoom} y={(s.a.y + s.b.y) / 2 - 7 / zoom} fontSize={11 / zoom} fill="#126e71" className="svg-label">{tool === 'cable' ? cableSegments.indexOf(s.id) + 1 || '' : `${r.number}.${index + 1}`}</text>}
              </g>;
            }))}
            {route && tool === 'select' && Array.from(new Map(route.segments.flatMap(s => [s.a, s.b]).filter(v => v.floorId === floor.id).map(v => [v.id, v])).values()).map(v => <circle data-object="vertex" data-route={route.id} key={v.id} cx={v.x} cy={v.y} r={5 / zoom} fill="white" stroke="#008e94" strokeWidth={2 / zoom} className="vertex-handle" onPointerDown={e => startDrag(e, 'vertex', route.id, v.id)} />)}
            {project.equipment.filter(eq => eq.floorId === floor.id).map(eq => <g data-object="equipment" data-id={eq.id} data-icon={equipmentIcon(eq.type)} data-color={equipmentColor(eq)} key={eq.id} transform={`translate(${eq.x},${eq.y})`} className={`equipment-symbol ${selection?.id === eq.id ? 'is-selected' : ''}`} onPointerDown={e => { if (pinching.current) return; if (tool === 'select') { setSelection({ kind: 'equipment', id: eq.id }); startDrag(e, 'equipment', eq.id); } else if (tool === 'route') { e.stopPropagation(); armTap(e, () => setDraft(points => { const p = { x: eq.x, y: eq.y }; const last = points[points.length - 1]; return ortho && last && last.x !== p.x && last.y !== p.y ? [...points, { x: p.x, y: last.y }, p] : [...points, p]; })); } else if (tool === 'cable') { e.stopPropagation(); armTap(e, () => { if (!cableFrom) { setCableFrom(eq.id); setMessage(`Начало: ${eq.number}. Коснитесь конечного устройства.`); } else if (cableTo !== eq.id) { setCableTo(eq.id); const res = findRoute(project, cableFrom, eq.id); if (res.error) { setCableSegments([]); setError(res.error); } else { setCableSegments(res.segmentIds); setMessage(`Конец: ${eq.number}. Маршрут построен автоматически: ${res.segmentIds.length} сегм.`); } } }); } }}>
              <EquipmentSymbol item={eq} zoom={zoom} />
            </g>)}
            {project.pins.filter(pin => pin.floorId === floor.id).map(pin => <g data-object="pin" data-id={pin.id} key={pin.id} transform={`translate(${pin.x},${pin.y})`} className={`pin-symbol ${selection?.id === pin.id ? 'is-selected' : ''}`} onPointerDown={e => { e.stopPropagation(); if (pinching.current) return; if (tool === 'select') { setSelection({ kind: 'pin', id: pin.id }); setTab('pins'); setView('plan'); } }}>
              <circle r={9 / zoom} fill={pin.status === 'closed' ? '#2f9e63' : '#e78c22'} stroke="#fff" strokeWidth={2 / zoom} />
              <text x={13 / zoom} y={4 / zoom} fontSize={12 / zoom} className="svg-label" fill="#122936">{pin.number}</text>
            </g>)}
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
        <div className="plan-badge"><span className="dot calibrated" />{floor?.name || 'Нет этажей'}<span> / </span>{floor?.metersPerUnit ? `${number(floor.metersPerUnit)} м/ед.` : 'Масштаб не задан'}</div>
        <div className="plan-legend"><span className="legend-line" /> Трасса <span className="legend-equipment" /> Оборудование <span className="legend-cable" /> Выбранный кабель</div>
      </div><div className="tool-hint"><span>{toolHints[tool]}</span><small>Координаты PDF: {pointer ? `${number(pointer.x)}; ${number(pointer.y)}` : '—'}</small></div><PlanAccessibilityList project={project} floor={floor} /></div> : view === 'journal' ? <section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Кабельный журнал</h1><p>Расчёт по выбранным сегментам, высотам и запасам. Единица измерения — метр.</p></div><button className="primary" onClick={() => { setView('plan'); setTool('cable'); }}>＋ Кабель</button></div><div className="table-scroll"><table><thead><tr><th>Кабель / марка</th><th>От → до</th><th>Геометрия</th><th>Запас трасс</th><th>Запас кабеля</th><th>Концы</th><th>Итог / шт.</th><th>Кол.</th><th>Стоимость, ₽</th><th>Статус</th></tr></thead><tbody>{project.cables.map(c => { const calc = cableCalcs.get(c.id)!; return <tr key={c.id} className={selection?.id === c.id ? 'selected' : ''} onClick={() => setSelection({ kind: 'cable', id: c.id })}><td><strong>{c.number}</strong><small>{c.brand || c.name}</small></td><td>{project.equipment.find(e => e.id === c.fromId)?.number || '?'} → {project.equipment.find(e => e.id === c.toId)?.number || '?'}</td><td>{number(calc.geometry)}</td><td>{number(calc.routeReserve)}</td><td>{number(calc.cableReserve)}</td><td>{number(calc.endReserve)}</td><td><strong>{number(calc.total)}</strong></td><td>{c.quantity}</td><td>{calc.cost === null ? '—' : number(calc.cost)}</td><td><span className={`badge ${calc.complete ? 'good' : 'warn'}`}>{calc.complete ? 'Рассчитан' : 'Неполный'}</span></td></tr>; })}</tbody></table>{!project.cables.length && <div className="document-empty">Создайте кабель: выберите оборудование и упорядоченную цепочку сегментов на плане.</div>}</div><div className="document-summary"><strong>{totals.metersComplete ? `${number(totals.meters)} м` : "Метраж рассчитан не полностью"}</strong><span>{totals.costComplete ? `Стоимость: ${number(totals.cost)} ₽` : "Стоимость не рассчитана: задайте цены за метр"}</span></div><div className="document-note">Итог указан для одного кабеля. Количество применяется в ведомости. Неполные значения не подменяются нулём.</div></section> : view === 'specs' ? <section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Ведомости и проверка</h1><p>Кабельная продукция и инфраструктура. Общие сегменты инфраструктуры учитываются один раз.</p></div></div><SpecificationTables value={specifications(project)} /><h2>Замечания к проекту</h2><IssueList value={issues} /><div className="document-note">Расчёт не заменяет проверку проектировщиком. PDF может содержать разные масштабы: калибруйте каждый этаж и страницу отдельно. Совмещение осей этажей выполняется вручную.</div></section> : <EstimateScreen project={project} onChange={mutate} onMessage={setMessage} onError={setError} />}</main>
      <aside className={`properties ${propsOpen ? 'open' : ''}`}><div className="properties-title">Свойства<span>{equipment ? 'ОБОРУДОВАНИЕ' : route ? 'ТРАССА' : cable ? 'КАБЕЛЬ' : pin ? 'ЗАМЕЧАНИЕ' : 'ЭТАЖ'}</span><button className="properties-close" aria-label="Закрыть" onClick={() => setPropsOpen(false)}>×</button></div><div className="properties-content">{selection && pin ? <PinProperties
        pin={pin}
        floors={project.floors}
        photoUrls={photoUrls}
        onChange={patch => mutate(p => { const item = p.pins.find(entry => entry.id === pin.id); if (item) { Object.assign(item, patch); item.updatedAt = new Date().toISOString(); } })}
        onRemove={() => removeObject('pin', pin.id)}
        onCopy={copySelection}
        onAddPhoto={() => photoInput.current?.click()}
        onCamera={() => cameraInput.current?.click()}
        onRemovePhoto={removePhoto}
      /> : selection && (equipment || route || cable) ? <><div className="object-heading"><span className="eyebrow">{equipment ? 'ОБОРУДОВАНИЕ' : route ? 'КАБЕЛЬНАЯ ТРАССА' : 'КАБЕЛЬ'}</span><h2>{(equipment || route || cable)?.number}</h2></div>{itemField('Обозначение', 'number')}{!route && itemField('Наименование', 'name')}{(equipment || route) && itemField('Тип', 'type')}{equipment && <div className="chip-row">{['Камера', 'Шкаф', 'Коммутатор', 'Считыватель', 'Розетка', 'Лоток'].map(value => <button key={value} className="chip" onClick={() => setItem('type', value)}>{value}</button>)}</div>}
      {equipment && <div className="equipment-appearance"><div className="section-label">Иконка <span>{equipmentIconLabel(equipment.type)}</span></div><div className="icon-preview"><EquipmentIcon item={equipment} size={30} /><span>{equipmentIconLabel(equipment.type)}</span></div><div className="section-label">Цвет иконки <span>{equipmentColor(equipment)}</span></div><div className="color-swatches">{EQUIPMENT_COLOR_PRESETS.map(preset => { const active = equipmentColor(equipment) === preset; return <button key={preset} type="button" className={`color-swatch ${active ? 'active' : ''}`} style={{ background: preset }} aria-label={`Цвет ${preset}`} title={`Цвет ${preset}`} aria-pressed={active} onClick={() => setItem('color', preset)} />; })}<input className="color-custom" type="color" value={equipmentColor(equipment)} onChange={e => setItem('color', e.target.value)} aria-label="Свой цвет иконки" title="Свой цвет иконки" /><button type="button" className="color-default" onClick={() => setItem('color', null)}>По умолчанию</button></div><p className="help">Цвет хранится в проекте и попадает в JSON-копию. По умолчанию цвет зависит от типа оборудования.</p></div>}
      {equipment && <><label className="field">Этаж{floorSelect(equipment.floorId, value => setItem('floorId', value))}</label><div className="field-pair">{itemField('X, ед. PDF', 'x', true)}{itemField('Y, ед. PDF', 'y', true)}</div>{itemField('Высота от пола, м', 'height', true)}<p className="help">Пустая высота означает неизвестное значение. Для подводов кабеля задайте высоту явно, в том числе 0.</p><div className="section-label">Фотографии <span>{equipment.photos?.length || 0}</span></div><div className="photo-strip">{(equipment.photos || []).map(key => photoUrls[key] ? <div className="photo-card" key={key}><img src={photoUrls[key]} alt={`Фото ${equipment.number}`} /><button aria-label="Удалить фото" onClick={() => removePhoto(key)}>×</button></div> : null)}<button className="photo-add" onClick={() => photoInput.current?.click()}>＋ Фото</button><button className="photo-add" onClick={() => cameraInput.current?.click()}>📷 Снять</button></div><p className="help">Снимок монтажа хранится в проекте и попадает в JSON-копию вместе с PDF-планами.</p><details><summary>Дополнительные свойства</summary>{Object.entries(equipment.properties).map(([key, value]) => field(key, value, v => setItem('properties', { ...equipment.properties, [key]: v })))}<button onClick={() => { const key = window.prompt('Название свойства'); if (key) setItem('properties', { ...equipment.properties, [key]: '' }); }}>＋ Свойство</button></details></>}
      {route && <><div className="field-pair">{itemField('Ширина лотка, мм', 'trayWidthMm', true)}{itemField('Высота борта, мм', 'trayHeightMm', true)}</div>{itemField('Площадь лотка, мм²', 'trayAreaMm2', true)}<p className="help">Площадь лотка важнее ширины и высоты: если задана, считается она. Пусто — размер неизвестен, заполнение лотка не рассчитывается.</p><div className="section-label">Заполнение лотка <span>{routeFillWorst ? trayFillText(routeFillWorst.fillPercent, routeFillWorst.status) : 'не рассчитано'}</span></div><div className="tray-fill">{route.segments.map((segment, index) => { const row = fill.segments.find(entry => entry.segmentId === segment.id); return <div className={`tray-fill-row ${row?.status ?? 'empty'}`} key={segment.id}><strong>{route.number}.{index + 1}</strong><span>{fillPercentText(row?.fillPercent)}</span><em>{row ? fillStatus(row.status) : 'нет данных'}</em>{row?.warnings?.length ? <small>{row.warnings.join(' ')}</small> : null}</div>; })}</div><p className="help">Порог внимания — 40 %, превышения — 50 %. Максимум по трассе: {routeFillWorst ? trayFillText(routeFillWorst.fillPercent, routeFillWorst.status) : 'не рассчитано'}.</p><div className="section-label">Сегменты <span>{route.segments.length}</span></div><p className="help">Вершины тянутся на плане. Координаты и высоты можно задать точно ниже. При ручном изменении согласуйте соседние вершины.</p>{route.segments.map((s, index) => <details className="segment-editor" key={s.id}><summary>Сегмент {route.number}.{index + 1} {s.a.floorId !== s.b.floorId ? ' · стояк ↕' : ''}</summary><label className="field">Геометрия<select value={s.mode} onChange={e => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(segment => segment.id === s.id)!.mode = e.target.value as Segment['mode']; })}><option value="orthogonal">Ортогональная</option><option value="spatial">Пространственная</option></select></label>{(['a', 'b'] as const).map(end => <div className="endpoint" key={end}><strong>{end === 'a' ? 'Начало' : 'Конец'}</strong><label className="field">Этаж{floorSelect(s[end].floorId, value => segmentField(s, end, 'floorId', value))}</label><div className="field-pair">{field('X', s[end].x, v => segmentField(s, end, 'x', Number(v)), true)}{field('Y', s[end].y, v => segmentField(s, end, 'y', Number(v)), true)}</div>{field('Высота, м', s[end].height, v => segmentField(s, end, 'height', v === '' ? null : Number(v)), true)}</div>)}<div className="field-pair">{field('Запас, %', s.reservePercent, v => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(seg => seg.id === s.id)!.reservePercent = Number(v); }), true)}{field('Запас, м', s.reserveFixed, v => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(seg => seg.id === s.id)!.reserveFixed = Number(v); }), true)}</div><button className="danger" onClick={() => { const linked = project.cables.filter(c => c.segmentIds.includes(s.id)); if (window.confirm(`Удалить сегмент? ${linked.length ? `Связанных кабелей: ${linked.length}. Они будут удалены.` : ''}`)) mutate(p => { p.routes.find(r => r.id === route.id)!.segments = p.routes.find(r => r.id === route.id)!.segments.filter(seg => seg.id !== s.id); p.cables = p.cables.filter(c => !c.segmentIds.includes(s.id)); }); }}>Удалить сегмент</button></details>)}<button className="wide" onClick={addRiser}>＋ Межэтажный стояк</button></>}
      {cable && <>{itemField('Марка', 'brand')}{itemField('Назначение', 'purpose')}<label className="field">От{equipmentSelect(cable.fromId, value => setItem('fromId', value))}</label><label className="field">До{equipmentSelect(cable.toId, value => setItem('toId', value))}</label><div className="field-pair">{itemField('Запас, %', 'reservePercent', true)}{itemField('Запас, м', 'reserveFixed', true)}</div><div className="field-pair">{itemField('На начале, м', 'startReserve', true)}{itemField('На конце, м', 'endReserve', true)}</div>{itemField('Количество', 'quantity', true)}{field('Цена за метр, ₽', cable.pricePerMeter ?? '', value => setItem('pricePerMeter', value === '' ? null : Number(value)), true, 'Ручная цена; если пусто — берётся из справочника цен')}<div className="field-pair">{itemField('Внешний диаметр, мм', 'outerDiameterMm', true)}{itemField('Площадь сечения, мм²', 'crossSectionMm2', true)}</div><p className="help">Площадь важнее диаметра: если заданы оба, считается площадь. Пусто — значение неизвестно, заполнение не рассчитывается.</p><div className="section-label">Порядок обхода</div><ol className="segment-order">{cable.segmentIds.map((id, i) => <li key={id}><span>{segmentName(id)}</span><button disabled={!i} title="Выше" onClick={() => { const next = [...cable.segmentIds]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setItem('segmentIds', next); }}>↑</button><button disabled={i === cable.segmentIds.length - 1} title="Ниже" onClick={() => { const next = [...cable.segmentIds]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setItem('segmentIds', next); }}>↓</button><button title="Удалить из цепочки" onClick={() => setItem('segmentIds', cable.segmentIds.filter(s => s !== id))}>×</button></li>)}</ol><button className="wide" onClick={() => { setCableSegments([...cable.segmentIds]); setCableFrom(cable.fromId); setCableTo(cable.toId); setTool('cable'); setView('plan'); setMessage('Измените цепочку кликами. Кнопка «Применить» в свойствах сохранит выбор.'); }}>Выбрать сегменты на плане</button>{tool === 'cable' && <button className="primary wide" onClick={() => { setItem('segmentIds', [...cableSegments]); setItem('fromId', cableFrom); setItem('toId', cableTo); setTool('select'); setCableSegments([]); }}>Применить цепочку к {cable.number}</button>}{calculation && <div className={`calculation-card ${calculation.complete ? '' : 'incomplete'}`}><span>ИТОГ / 1 КАБЕЛЬ</span><strong>{number(calculation.total)} <small>м</small></strong><dl><dt>Геометрия</dt><dd>{number(calculation.geometry)} м</dd><dt>Запас трассы</dt><dd>{number(calculation.routeReserve)} м</dd><dt>Запас кабеля</dt><dd>{number(calculation.cableReserve)} м</dd><dt>Запас концов</dt><dd>{number(calculation.endReserve)} м</dd><dt>Сечение</dt><dd>{areaMm2Text(cableSectionResult?.areaMm2)}</dd><dt>Заполнение лотка</dt><dd>{trayFillText(cableFill?.percent, cableFill?.status)}</dd></dl>{calculation.errors.map((e, i) => <p key={i}>{e}</p>)}{cableSectionResult?.errors.map((e, i) => <p key={'section-' + i}>{e}</p>)}{cableFill && cableFill.unknown > 0 && <p>Заполнение не рассчитано для сегментов: {cableFill.unknown} (неизвестен лоток или сечение кабеля).</p>}</div>}</>}
      <label className="field">Примечание<textarea value={(equipment || route || cable)?.note || ''} onChange={e => setItem('note', e.target.value)} /></label><div className="property-actions"><button onClick={copySelection}>Копировать</button><button className="danger" onClick={removeSelection}>Удалить</button></div></> : floor ? <><div className="object-heading"><span className="eyebrow">ТЕКУЩИЙ ЭТАЖ</span><h2>{floor.name}</h2></div>{field('Название', floor.name, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.name = v; }))}{field('Отметка пола, м', floor.elevation, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.elevation = v === '' ? null : Number(v); }), true, 'Абсолютная отметка для расчёта межэтажных стояков.')}<div className="scale-card"><span className="eyebrow">МАСШТАБ ПОДЛОЖКИ</span><strong>{floor.metersPerUnit ? `${number(floor.metersPerUnit)} м/ед.` : 'Не откалиброван'}</strong><button onClick={() => { setTool('calibrate'); setView('plan'); setCalibration([]); }}>↔ Калибровка по 2 точкам</button></div><details className="scale-presets"><summary>Масштаб по формату листа</summary><div className="field-pair"><label className="field">Формат<select value={sheetFormat} onChange={e => setSheetFormat(e.target.value)}>{Object.keys(SHEET_SIZES).map(size => <option key={size} value={size}>{size}</option>)}</select></label><label className="field">Масштаб<select value={sheetScale} onChange={e => setSheetScale(e.target.value)}>{['50', '100', '200', '500'].map(value => <option key={value} value={value}>1:{value}</option>)}</select></label></div><button className="wide" onClick={applySheetScale}>Применить масштаб листа</button><p className="help">Если план — стандартный лист {sheetFormat} в масштабе 1:{sheetScale}, калибровка двумя точками не нужна.</p></details>{field('Метров в единице PDF', floor.metersPerUnit, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.metersPerUnit = v === '' ? null : Number(v); }), true)}<div className="section-label">Подложка</div><p className="help">{floor.pdfId ? `Исходный PDF подключён. Страница ${floor.page}; ${number(floor.width)} × ${number(floor.height)} ед.` : 'PDF не загружен. Можно чертить на чистом листе; для метража необходим масштаб.'}</p>{floor.pdfId && pdfPages > 0 && <label className="field mobile-only">Страница PDF<input type="number" min="1" max={pdfPages} value={floor.page} onChange={e => { const page = Math.max(1, Math.min(pdfPages, Number(e.target.value) || 1)); if (page !== floor.page) mutate(p => { const f = p.floors.find(f => f.id === floor.id)!; f.page = page; f.metersPerUnit = null; }); }} /></label>}<button className="wide" disabled={busy} onClick={() => upload.current?.click()}>↑ {floor.pdfId ? 'Заменить PDF…' : 'Загрузить PDF…'}</button><p className="help">При замене PDF или страницы объекты остаются на прежних координатах. Проверьте положение и повторите калибровку.</p><div className="section-label">Система координат</div><p className="help">X/Y хранятся в единицах PDF. Зум не влияет на длины. Для стояка совпадающие X/Y на разных этажах должны соответствовать одной физической оси.</p><button className="danger wide" disabled={project.floors.length < 2} onClick={() => { const eqIds = project.equipment.filter(eq => eq.floorId === floor.id).map(eq => eq.id); const pinIds = project.pins.filter(pin => pin.floorId === floor.id).map(pin => pin.id); const segmentIds = project.routes.flatMap(r => r.segments).filter(s => s.a.floorId === floor.id || s.b.floorId === floor.id).map(s => s.id); if (window.confirm('Удалить этаж, его оборудование, связанные сегменты и кабели?')) { const photoKeys = orphanPhotoKeys(project, [...eqIds, ...pinIds]); mutate(p => { p.floors = p.floors.filter(f => f.id !== floor.id); p.equipment = p.equipment.filter(eq => eq.floorId !== floor.id); p.pins = p.pins.filter(pin => pin.floorId !== floor.id); p.routes.forEach(r => { r.segments = r.segments.filter(s => !segmentIds.includes(s.id)); }); p.routes = p.routes.filter(r => r.segments.length); p.cables = p.cables.filter(c => !eqIds.includes(c.fromId) && !eqIds.includes(c.toId) && !c.segmentIds.some(id => segmentIds.includes(id))); }); void purgePhotoBlobs(photoKeys, idbDelete); setFloorId(''); } }}>Удалить этаж</button></> : <p className="help">Добавьте этаж для начала работы.</p>}</div></aside>
    </div><footer className="statusbar"><span role="status" aria-live="polite"><i className="dot calibrated" />{message}</span><span>{project.equipment.length} оборуд. · {project.routes.length} трасс · {project.cables.length} кабелей <b>{staticMode ? 'БРАУЗЕР' : 'СЕРВЕР'}</b></span></footer>
    {aboutOpen && <AboutSheet
      onClose={() => setAboutOpen(false)}
      diagnostics={diagnostics}
      onExportDiagnostics={() => void run(exportDiagnostics)}
      onClearDiagnostics={() => { clearDiagnostics(); setDiagnostics([]); }}
    />}
    {(menuOpen || propsOpen) && <div className="scrim" onClick={() => { setMenuOpen(false); setPropsOpen(false); }} />}
    <button className={`props-fab ${propsOpen ? 'active' : ''}`} aria-label="Свойства" onClick={() => setPropsOpen(v => !v)}>⚙</button>
    <div className="history-fab">
      <button title="Отменить Ctrl+Z" aria-label="Отменить" disabled={!undo.length} onClick={() => history(true)}>↶</button>
      <button title="Повторить Ctrl+Shift+Z" aria-label="Повторить" disabled={!redo.length} onClick={() => history(false)}>↷</button>
    </div>
    {exportOpen && <div className="sheet-backdrop" onClick={() => setExportOpen(false)}><section className="sheet" role="dialog" aria-label="Экспорт и копия" onClick={event => event.stopPropagation()}><div className="sheet-grip" /><div className="sheet-head"><strong>Экспорт и копия</strong><button aria-label="Закрыть" onClick={() => setExportOpen(false)}>×</button></div><div className="sheet-list">{(['csv', 'xlsx', 'pdf', 'backup'] as const).map(format => <button key={format} disabled={busy} onClick={() => { setExportOpen(false); void run(() => download(format)); }}>{format === 'backup' ? 'JSON с исходными PDF' : format.toUpperCase()}</button>)}{typeof nativeBridge()?.printPdf === 'function' && <button onClick={() => { setExportOpen(false); void run(() => printJournal()); }}>Печать A4</button>}<div className="sheet-fields"><label className="field">Составил<input type="text" value={project.document?.compiledBy || ''} onChange={e => mutate(p => { p.document = { ...(p.document || {}), compiledBy: e.target.value }; })} /></label><label className="field">Проверил<input type="text" value={project.document?.checkedBy || ''} onChange={e => mutate(p => { p.document = { ...(p.document || {}), checkedBy: e.target.value }; })} /></label></div><button onClick={() => { setExportOpen(false); void openHistory(); }}>История версий</button><button onClick={() => { setExportOpen(false); restoreInput.current?.click(); }}>Восстановить JSON…</button></div></section></div>}
    {historyOpen && <div className="sheet-backdrop" onClick={() => setHistoryOpen(false)}><section className="sheet" role="dialog" aria-label="История версий" onClick={event => event.stopPropagation()}><div className="sheet-grip" /><div className="sheet-head"><strong>История версий</strong><button aria-label="Закрыть" onClick={() => setHistoryOpen(false)}>×</button></div><div className="sheet-list"><button onClick={() => void takeSnapshot('вручную').then(() => openHistory()).catch(() => setError('Не удалось сделать снимок: хранилище недоступно.'))}>＋ Сделать снимок сейчас</button>{snapshots === null ? <p className="help">Загружаю…</p> : snapshots.length ? snapshots.map(entry => <div className="snapshot-row" key={entry.key}><button className="snapshot-open" onClick={() => void restoreSnapshot(entry.key)}><strong>{new Date(entry.createdAt).toLocaleString('ru-RU')}</strong><small>{entry.reason} · {entry.project.equipment.length} оборуд. · {entry.project.cables.length} кабелей</small></button><button className="snapshot-delete" aria-label="Удалить снимок" onClick={() => void deleteSnapshot(entry.key)}>🗑</button></div>) : <p className="help">Снимков пока нет. Они создаются автоматически раз в 5 минут при изменениях и при ручном сохранении.</p>}</div></section></div>}
    {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)}><section className="sheet" role="dialog" aria-label="Действия с объектом" onClick={event => event.stopPropagation()}><div className="sheet-grip" /><div className="sheet-head"><strong>{sheetTitle(sheet)}</strong><button aria-label="Закрыть" onClick={() => setSheet(null)}>×</button></div><div className="sheet-list"><button onClick={() => { setPropsOpen(true); setSheet(null); }}>⚙ Свойства</button><button onClick={() => { copyObject(sheet.kind, sheet.id); setSheet(null); }}>⧉ Копировать</button><button className="danger" onClick={() => removeObject(sheet.kind, sheet.id)}>🗑 Удалить</button></div></section></div>}
    <input hidden ref={photoInput} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => addPhoto(file)); e.target.value = ''; }} />
    <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => addPhoto(file)); e.target.value = ''; }} />
    <input hidden ref={upload} type="file" accept="application/pdf,.pdf" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => uploadPdf(file)); e.target.value = ''; }} />
    <input hidden ref={restoreInput} type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file && mayLeave()) void run(() => restoreProjectFile(file)); e.target.value = ''; }} />
    {projects && <div className="modal-backdrop"><section className="modal"><div className="modal-heading"><h2>Открыть проект</h2><button onClick={() => setProjects(null)}>×</button></div>{projects.length ? projects.map(p => <div className="project-row" key={p.id}><button className="project-option" disabled={busy} onClick={() => { if (mayLeave()) void run(async () => { const result = staticMode ? readLocalProjects().find(x => x.id === p.id)! : await api<Project>(`/api/projects/${p.id}`); load(result, true); setProjects(null); setMessage(`Проект «${result.name}» открыт.`); }); }}><strong>{p.name}</strong><small>{new Date(p.updatedAt).toLocaleString('ru-RU')}</small><span>→</span></button><button className="project-delete" disabled={busy} title="Удалить проект" onClick={() => void run(() => deleteProject(p.id, p.name))}>🗑</button></div>) : <p className="help">Сохранённых проектов пока нет.</p>}</section></div>}
  </div>;
}

/** Значок оборудования в системе 24×24: список объектов и превью в свойствах. */
function EquipmentIcon({ item, size = 18, className }: { item: { type: string; color?: string | null }; size?: number; className?: string }) {
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
function EquipmentSymbol({ item, zoom }: { item: Equipment; zoom: number }) {
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


const PRICE_KIND_LABELS: Record<PriceKind, string> = { equipment: 'Оборудование', cable: 'Кабель', tray: 'Лоток' };
const PRICE_SOURCE_LABELS: Record<'manual' | 'catalog', string> = { manual: 'вручную', catalog: 'справочник' };
/** Деньги и количества: null — «—», а не 0. */
const moneyText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? `${number(value)} ₽` : '—');
const quantityText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? number(value) : '—');
/** Неотрицательное конечное число из строки, иначе null (пусто/мусор/минус не сохраняются). */
const nonNegativeOrNull = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * Экран «Смета и коммерческое предложение»: расчёт по справочнику цен проекта,
 * процент работ и редактирование/импорт-экспорт самого справочника.
 */
function EstimateScreen({ project, onChange, onMessage, onError }: {
  project: Project;
  onChange: (recipe: (project: Project) => void) => void;
  onMessage: (text: string) => void;
  onError: (text: string) => void;
}) {
  const result = useMemo(() => estimate(project), [project]);
  const importInput = useRef<HTMLInputElement>(null);
  const catalog = project.catalog ?? [];
  function updateCatalogItem(index: number, patch: Partial<PriceItem>): void {
    onChange(p => {
      const items = [...(p.catalog ?? [])];
      if (!items[index]) return;
      items[index] = { ...items[index], ...patch };
      p.catalog = items;
    });
  }
  function setEstimate(patch: { laborPercent?: number | null; note?: string }): void {
    onChange(p => { p.estimate = { ...(p.estimate ?? { laborPercent: null }), ...patch }; });
  }
  async function exportCatalog(): Promise<void> {
    try {
      const payload = { schemaVersion: 2, catalog, catalogDate: project.catalogDate ?? null };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const name = `AnOOPlan-каталог-${project.catalogDate || new Date().toISOString().slice(0, 10)}.json`;
      const savedPath = await saveBlobOnDevice(name, blob);
      if (!savedPath) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      onMessage(savedPath ? `Справочник цен сохранён: ${savedPath}` : 'Справочник цен сформирован.');
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  async function importCatalogFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        onError('Не удалось прочитать JSON: файл повреждён или это не JSON.');
        return;
      }
      const container = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      const raw = container && Array.isArray(container.catalog) ? container.catalog : Array.isArray(parsed) ? parsed : null;
      if (!raw) {
        onError('Файл не похож на справочник цен: ожидается массив позиций или объект с полем catalog.');
        return;
      }
      const items = normalizeCatalog(raw);
      if (!window.confirm(`Заменить справочник цен? Позиций в файле: ${items.length}`)) return;
      const rawDate = container ? container.catalogDate : null;
      // Невалидную/отсутствующую дату из файла не сохраняем и не затираем текущую дату прайса.
      onChange(p => { p.catalog = items; if (isCatalogDate(rawDate)) p.catalogDate = rawDate; });
      onMessage(`Справочник цен импортирован: ${items.length} поз.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  const catalogDateText = project.catalogDate || result.catalogDate || 'не задана';
  return <section className="document-view estimate-view">
    <div className="document-title">
      <div>
        <span className="eyebrow">ДОКУМЕНТАЦИЯ</span>
        <h1>Смета и коммерческое предложение</h1>
        <p>Стоимость материалов по справочнику цен и работы процентом от материалов. Неизвестные цены не подменяются нулём.</p>
      </div>
      <div className="estimate-status">
        <span className={`badge ${result.complete ? 'good' : 'warn'}`}>{result.complete ? 'Смета рассчитана' : 'Смета неполная'}</span>
        <small>Дата прайса: <strong>{catalogDateText}</strong></small>
      </div>
    </div>
    <div className="estimate-controls">
      <label className="field estimate-labor">Работы, %<NumberField value={project.estimate?.laborPercent ?? null} ariaLabel="Работы, %" placeholder="Не задано" onCommit={raw => setEstimate({ laborPercent: raw === '' ? null : nonNegativeOrNull(raw) })} /></label>
      <label className="field estimate-note-field">Примечание к смете<input type="text" value={project.estimate?.note ?? ''} placeholder="Например: Цены действительны 30 дней" onChange={event => setEstimate({ note: event.target.value })} /></label>
    </div>
    {!result.complete && <div className="estimate-warnings"><strong>Смета неполная</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {result.sections.map(section => <section className="estimate-section" key={section.kind}>
      <div className="estimate-section-head">
        <h2>{section.title}</h2>
        <span className={`badge ${section.complete ? 'good' : 'warn'}`}>{section.complete ? 'раздел рассчитан' : 'неполный раздел'}</span>
      </div>
      {section.kind === 'work' ? <div className="estimate-work-summary">
        <p>Работы {result.laborPercent === null ? 'не рассчитаны: не задан процент.' : `— ${number(result.laborPercent)} % от стоимости материалов.`}</p>
        <div className="estimate-section-total"><span>Итого по разделу</span><strong>{section.total === null ? 'не рассчитано' : moneyText(section.total)}</strong></div>
        {result.laborPercent !== null && section.total === null && <p className="help">Стоимость работ не рассчитана: сначала должна быть известна стоимость материалов.</p>}
      </div> : <>
        <div className="table-scroll"><table className="estimate-table">
          <thead><tr><th>Позиция</th><th>Ед.</th><th>Количество</th><th>Цена, ₽</th><th>Сумма, ₽</th><th>Источник</th></tr></thead>
          <tbody>
            {section.lines.map(line => <tr key={line.id}>
              <td><strong>{line.name}</strong>{line.note ? <small>{line.note}</small> : null}</td>
              <td>{line.unit || '—'}</td>
              <td>{quantityText(line.quantity)}</td>
              <td>{moneyText(line.price)}</td>
              <td>{moneyText(line.total)}</td>
              <td>{line.priceSource ? PRICE_SOURCE_LABELS[line.priceSource] : '—'}</td>
            </tr>)}
            {!section.lines.length && <tr><td colSpan={6}>Позиций нет.</td></tr>}
          </tbody>
        </table></div>
        <div className="estimate-section-total"><span>Итого по разделу</span><strong>{section.total === null ? 'не рассчитано' : moneyText(section.total)}</strong></div>
        {section.warnings.map((warning, index) => <p className="help" key={index}>{warning}</p>)}
      </>}
    </section>)}
    <div className="estimate-totals">
      <div><span>Материалы</span><strong>{result.materials === null ? 'не рассчитано' : moneyText(result.materials)}</strong></div>
      <div><span>Работы{result.laborPercent === null ? '' : ` (${number(result.laborPercent)} %)`}</span><strong>{result.labor === null ? 'не рассчитано' : moneyText(result.labor)}</strong></div>
      <div className="estimate-grand"><span>ИТОГО</span><strong className="estimate-total-value">{result.total === null ? 'Смета не рассчитана' : moneyText(result.total)}</strong></div>
    </div>
    <p className="document-note">Смета считается по справочнику цен проекта; ручная цена кабеля приоритетнее справочника. Дата прайса: {catalogDateText}.{project.estimate?.note ? ` Примечание: ${project.estimate.note}.` : ''} Пустые цены не подменяются нулём — они помечены «—» и делают смету неполной.</p>
    <details className="catalog-editor">
      <summary>Справочник цен <span>{catalog.length}</span></summary>
      <div className="catalog-controls">
        <label className="field catalog-date">Дата прайса<input type="date" value={project.catalogDate ?? ''} aria-label="Дата прайса" onChange={event => onChange(p => { p.catalogDate = event.target.value || null; })} /></label>
        <div className="catalog-actions">
          <button type="button" className="catalog-export" onClick={() => void exportCatalog()}>Экспорт справочника</button>
          <button type="button" className="catalog-import" onClick={() => importInput.current?.click()}>Импорт справочника</button>
          <button type="button" onClick={() => onChange(p => { p.catalog = [...(p.catalog ?? []), { id: uid(), kind: 'equipment', name: 'Новая позиция', unit: 'шт', price: null, note: '' }]; })}>＋ Позиция</button>
        </div>
      </div>
      <div className="table-scroll"><table className="catalog-table">
        <thead><tr><th>Вид</th><th>Наименование</th><th>Ед.</th><th>Цена, ₽</th><th>Примечание</th><th /></tr></thead>
        <tbody>
          {catalog.map((item, index) => <tr key={item.id}>
            <td className="catalog-kind"><select value={item.kind} aria-label={`Вид позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { kind: event.target.value as PriceKind })}>{(['equipment', 'cable', 'tray'] as const).map(kind => <option key={kind} value={kind}>{PRICE_KIND_LABELS[kind]}</option>)}</select></td>
            <td className="catalog-name"><input type="text" value={item.name} aria-label={`Наименование позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { name: event.target.value })} /></td>
            <td className="catalog-unit"><input type="text" value={item.unit} aria-label={`Единица позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { unit: event.target.value })} /></td>
            <td className="catalog-price"><NumberField value={item.price} placeholder="Не задано" ariaLabel={`Цена позиции ${index + 1}`} onCommit={raw => updateCatalogItem(index, { price: raw === '' ? null : nonNegativeOrNull(raw) })} /></td>
            <td className="catalog-note"><input type="text" value={item.note} aria-label={`Примечание позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { note: event.target.value })} /></td>
            <td className="catalog-remove"><button type="button" aria-label={`Удалить позицию ${item.name}`} title="Удалить позицию" onClick={() => onChange(p => { p.catalog = (p.catalog ?? []).filter(entry => entry.id !== item.id); })}>×</button></td>
          </tr>)}
          {!catalog.length && <tr><td colSpan={6}>Справочник пуст. Добавьте позиции или импортируйте JSON.</td></tr>}
        </tbody>
      </table></div>
      <p className="help">Позиции справочника сопоставляются по виду и наименованию без учёта регистра. Цена «—» означает «неизвестно», а не 0. Пустое поле «Работы, %» также делает смету неполной.</p>
    </details>
    <input hidden ref={importInput} type="file" accept=".json,application/json" className="catalog-import-input" onChange={event => { const file = event.target.files?.[0]; if (file) void importCatalogFile(file); event.target.value = ''; }} />
  </section>;
}

function IssueList({ value }: { value: unknown }) {
  if (Array.isArray(value)) return value.length ? <ul className="issues-list">{value.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul> : <div className="validation-good">✓ Структурных замечаний не найдено. Проверьте рабочую документацию перед применением.</div>;
  return <pre className="data-json">{JSON.stringify(value, null, 2)}</pre>;
}
const labels: Record<string, string> = { cables: 'Кабельная продукция', cable: 'Кабельная продукция', infrastructure: 'Кабельная инфраструктура', routes: 'Кабельная инфраструктура', errors: 'Замечания', warnings: 'Предупреждения', name: 'Наименование', brand: 'Марка', type: 'Тип', purpose: 'Назначение', number: 'Обозначение', quantity: 'Количество', length: 'Длина, м', total: 'Всего, м', totalLength: 'Всего, м', complete: 'Полный расчёт', unit: 'Ед.', routeId: 'ID трассы', cableId: 'ID кабеля', segmentId: 'ID сегмента', reserve: 'Запас', geometry: 'Геометрия, м', totalQuantity: 'Количество', totalMeters: 'Всего, м', incomplete: 'Неполные', id: 'ID', trayFill: 'Заполнение лотков', route: 'Трасса', segment: 'Сегмент', routeType: 'Тип трассы', tray: 'Лоток, мм', trayAreaMm2: 'Площадь лотка, мм²', lines: 'Линий', areaMm2: 'Площадь кабелей, мм²', fillPercent: 'Заполнение, %', status: 'Статус', maxFillPercent: 'Макс. заполнение, %', overSegments: 'Сегментов с превышением', unknownCables: 'Кабелей без сечения', usedAreaMm2: 'Занято, мм²' };
function SpecificationTables({ value }: { value: unknown }) {
  function render(data: unknown, key: string): React.ReactNode {
    if (Array.isArray(data)) {
      if (!data.length) return <p className="help">Нет данных.</p>;
      if (data.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) {
        const rows = data as Record<string, unknown>[]; const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
        return <div className="table-scroll"><table><thead><tr>{columns.map(col => <th key={col}>{labels[col] || col}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(col => <td key={col}>{typeof row[col] === 'number' ? number(row[col]) : typeof row[col] === 'boolean' ? row[col] ? 'Да' : 'Нет' : row[col] === null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : col === 'status' && typeof row[col] === 'string' ? FILL_STATUS_LABELS[row[col]] ?? row[col] : String(row[col] ?? '—')}</td>)}</tr>)}</tbody></table></div>;
      }
      return <IssueList value={data} />;
    }
    if (data && typeof data === 'object') return <>{Object.entries(data).map(([name, item]) => <section className="spec-section" key={name}><h2>{labels[name] || name}</h2>{render(item, name)}</section>)}</>;
    return <div className="spec-value" style={{ '--spec-key': key } as CSSProperties}>{typeof data === 'number' ? number(data) : String(data ?? '—')}</div>;
  }
  return <div className="specifications">{render(value, 'root')}</div>;
}
