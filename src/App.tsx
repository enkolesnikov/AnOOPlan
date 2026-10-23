import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Project, Floor, Equipment, Route, Cable, Segment, Vertex, Point } from './model';
import { calculateCable, specifications, validateProject, domainWarnings, chainEnds, findRoute } from './engine';
import { createDemoProject } from './demo';
import { exportSheets } from './sheets';
import type { JournalPhoto } from './export-pdf';
import { planRender, fallbackPlan, needsClipping, type PlanRender } from './render-plan';
import { buildPlanSvg } from './plan-svg';
import { orphanPhotoKeys, purgePhotoBlobs } from './photos';

type PdfjsModule = typeof import('pdfjs-dist');
type PdfLoadingTask = ReturnType<PdfjsModule['getDocument']>;
type PdfRenderTask = ReturnType<import('pdfjs-dist').PDFPageProxy['render']>;
const SNAP_PX = 12;
const SNAPSHOT_LIMIT = 20;
// Бюджет пикселей подложки: A4-A3 рисуются целиком, A1-A0 — по видимой области.
const PLAN_MAX_PIXELS = 12_000_000;
interface SnapshotEntry { key: string; createdAt: string; reason: string; project: Project }
const SHEET_SIZES: Record<string, { landscape: number; portrait: number }> = {
  A4: { landscape: 297, portrait: 210 },
  A3: { landscape: 420, portrait: 297 },
  A2: { landscape: 594, portrait: 420 },
  A1: { landscape: 841, portrait: 594 },
  A0: { landscape: 1189, portrait: 841 },
};
const CABLE_SNAP_LIMIT = 100;
type Selection = { kind: 'equipment' | 'route' | 'cable'; id: string } | null;
type Tool = 'select' | 'pan' | 'equipment' | 'route' | 'calibrate' | 'cable' | 'measure';
type View = 'plan' | 'journal' | 'specs';
const uid = () => crypto.randomUUID();
const clone = <T,>(value: T): T => structuredClone(value);
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '—';
const freshFloor = (name = 'Этаж 1'): Floor => ({ id: uid(), name, elevation: null, metersPerUnit: null, page: 1, width: 1000, height: 700 });
const freshProject = (): Project => ({ schemaVersion: 1, id: uid(), name: 'Новый проект', floors: [freshFloor()], equipment: [], routes: [], cables: [], updatedAt: new Date().toISOString() });
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) { const text = await response.text(); throw new Error(text || `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}
const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const LS_PROJECTS = 'cableplan:projects';
function lsProjects(): Project[] { try { const raw = localStorage.getItem(LS_PROJECTS); const list = JSON.parse(raw || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
function lsSave(project: Project) { const list = lsProjects(); const i = list.findIndex(p => p.id === project.id); if (i >= 0) list[i] = project; else list.push(project); localStorage.setItem(LS_PROJECTS, JSON.stringify(list)); }
function lsDelete(id: string) { localStorage.setItem(LS_PROJECTS, JSON.stringify(lsProjects().filter(p => p.id !== id))); }
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cableplan', 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pdfs')) req.result.createObjectStore('pdfs');
      if (!req.result.objectStoreNames.contains('snapshots')) req.result.createObjectStore('snapshots');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    const req = tx.objectStore('pdfs').get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
async function idbStorePut(store: string, key: string, value: unknown): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbStoreGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
async function idbStoreDelete(store: string, key: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbStoreKeys(store: string): Promise<string[]> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(key: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  const [propsOpen, setPropsOpen] = useState(false);
  const [tab, setTab] = useState<'floors' | 'equipment' | 'routes' | 'cables'>('floors');
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[] | null>(null);
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
  const [undo, setUndo] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: string }[] | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [renderPlan, setRenderPlan] = useState<PlanRender | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [pdfError, setPdfError] = useState('');
  const [pointer, setPointer] = useState<Point | null>(null);
  const [staticMode, setStaticMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{ kind: 'equipment' | 'route' | 'cable'; id: string } | null>(null);
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
  const pdfCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  projectRef.current = project;
  const floor = project.floors.find(f => f.id === floorId) || project.floors[0];
  const dirty = JSON.stringify(project) !== saved;
  const equipment = selection?.kind === 'equipment' ? project.equipment.find(e => e.id === selection.id) : undefined;
  const route = selection?.kind === 'route' ? project.routes.find(r => r.id === selection.id) : undefined;
  const cable = selection?.kind === 'cable' ? project.cables.find(c => c.id === selection.id) : undefined;
  const calculation = cable ? calculateCable(project, cable) : null;
  const issues = useMemo(() => [...validateProject(project), ...domainWarnings(project)], [project]);
  const cableCalcs = useMemo(() => new Map(project.cables.map(c => [c.id, calculateCable(project, c)])), [project]);
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

  function commit(next: Project | ((p: Project) => Project)) {
    const previous = projectRef.current;
    const value = typeof next === 'function' ? next(clone(previous)) : next;
    setUndo(items => [...items.slice(-59), clone(previous)]); setRedo([]);
    value.updatedAt = new Date().toISOString(); projectRef.current = value; setProject(value); setError('');
  }
  function mutate(fn: (p: Project) => void) { commit(p => { fn(p); return p; }); }
  function history(back: boolean) {
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    if (back) { setUndo(source.slice(0, -1)); setRedo(items => [...items, clone(project)]); }
    else { setRedo(source.slice(0, -1)); setUndo(items => [...items, clone(project)]); }
    setProject(clone(next)); projectRef.current = clone(next); setSelection(null); setDraft([]);
  }
  function load(p: Project, exists: boolean) {
    setProject(p); projectRef.current = p; setSaved(exists ? JSON.stringify(p) : ''); setPersisted(exists);
    setFloorId(p.floors[0]?.id || ''); setUndo([]); setRedo([]); setSelection(null); setDraft([]); setMeasure([]); setCalibration([]); setCableSegments([]); setView('plan'); setTool('select'); setError('');
  }
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function saveProject(silent = false): Promise<Project> {
    const snapshot = clone(projectRef.current);
    if (staticMode) {
      lsSave(snapshot); setPersisted(true); setSaved(JSON.stringify(snapshot));
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
      const target = lsProjects().find(p => p.id === id);
      if (target) for (const f of target.floors) if (f.pdfId?.startsWith('idb:')) { try { await idbDelete(f.pdfId.slice(4)); } catch { /* хранилище недоступно */ } }
      if (target) for (const item of target.equipment) for (const key of item.photos || []) { try { await idbDelete('photo:' + key); } catch { /* хранилище недоступно */ } }
      lsDelete(id);
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
  useEffect(() => { fetch('/api/health').then(r => { if (!r.ok) setStaticMode(true); }).catch(() => setStaticMode(true)); }, []);
  useEffect(() => {
    if (!staticMode) return;
    const timer = setTimeout(() => { try { localStorage.setItem('cableplan:autosave', JSON.stringify(projectRef.current)); } catch { /* переполнение localStorage */ } }, 800);
    return () => clearTimeout(timer);
  }, [project, staticMode]);
  // Проект, который уже лежит в списке, дописывается сам — «Сохранить» лишь для нового.
  useEffect(() => {
    if (!dirty || !persisted) return;
    const timer = setTimeout(() => { void saveProject(true).catch(() => { /* повторим при следующем изменении */ }); }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, project]);
  // Миниатюры фотографий выбранного оборудования берём из IndexedDB.
  useEffect(() => {
    const keys = equipment?.photos || [];
    if (!keys.length) { setPhotoUrls({}); return; }
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const map: Record<string, string> = {};
      for (const key of keys) {
        try {
          const blob = await idbGet('photo:' + key);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          created.push(url);
          map[key] = url;
        } catch { /* хранилище недоступно */ }
      }
      if (cancelled) { created.forEach(url => URL.revokeObjectURL(url)); return; }
      setPhotoUrls(map);
    })();
    return () => { cancelled = true; created.forEach(url => URL.revokeObjectURL(url)); };
  }, [equipment?.id, equipment?.photos?.length]);
  // Снимок версии: раз в пять минут при несохранённых изменениях и перед восстановлением.
  useEffect(() => {
    const timer = setInterval(() => { if (dirty) void takeSnapshot('автоснимок').catch(() => { /* хранилище недоступно */ }); }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [dirty]);
  // Нативная оболочка спрашивает, есть ли несохранённые изменения (кнопка/жест «Назад»).
  useEffect(() => { nativeBridge()?.setDirty?.(dirty); }, [dirty]);
  // Вызывается из Java: сохранить и только потом закрыть приложение.
  useEffect(() => {
    (window as Window & { __anooplanSaveAndExit?: () => Promise<void> }).__anooplanSaveAndExit = async () => {
      try { await saveProject(true); } catch { /* выходим в любом случае */ }
      nativeBridge()?.exitNow?.();
    };
  });
  useEffect(() => {
    if (!staticMode) return;
    try {
      const raw = localStorage.getItem('cableplan:autosave');
      if (!raw) return;
      const saved = JSON.parse(raw) as Project;
      if (saved && saved.schemaVersion === 1 && Array.isArray(saved.floors) && projectRef.current.name === 'Новый проект' && projectRef.current.equipment.length === 0) {
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
  useEffect(() => { setDraft([]); setCalibration([]); setMeasure([]); setPdfPages(0); setPdfError(''); }, [floor?.id, floor?.pdfId]);
  useEffect(() => {
    if (!floor?.pdfId || view !== 'plan') return;
    const currentFloor = floor;
    const pdfId = floor.pdfId;
    const { zoom: currentZoom, pan: currentPan } = viewRef.current;
    const stageElement = stage.current;
    const viewWidth = stageElement?.clientWidth || currentFloor.width * currentZoom;
    const viewHeight = stageElement?.clientHeight || currentFloor.height * currentZoom;
    const plan = planRender({
      sheetWidth: currentFloor.width, sheetHeight: currentFloor.height,
      zoom: currentZoom, dpr: window.devicePixelRatio || 1,
      viewWidth, viewHeight, panX: currentPan.x, panY: currentPan.y,
      maxPixels: PLAN_MAX_PIXELS,
    });
    const key = `${currentFloor.id}:${pdfId}:${currentFloor.page}:${plan.clipped ? `${plan.scale.toFixed(2)}:${Math.round(plan.clipX)}:${Math.round(plan.clipY)}` : 'full'}`;
    const target = canvas.current; if (!target) return;
    if (!plan.clipped && pdfCache.current?.key === key) {
      const cached = pdfCache.current.canvas;
      target.width = cached.width; target.height = cached.height;
      const cacheContext = target.getContext('2d');
      if (cacheContext) cacheContext.drawImage(cached, 0, 0);
      setRenderPlan(plan);
      return;
    }
    let cancelled = false;
    let renderTask: PdfRenderTask | undefined;
    let loadingTask: PdfLoadingTask | undefined;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        if (pdfId.startsWith('idb:')) {
          const blob = await idbGet(pdfId.slice(4));
          if (!blob) throw new Error('PDF не найден в хранилище браузера');
          loadingTask = pdfjs.getDocument({ data: await blob.arrayBuffer() });
        } else if (pdfId.startsWith('data:')) {
          const base64 = pdfId.slice(pdfId.indexOf(',') + 1);
          loadingTask = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), c => c.charCodeAt(0)) });
        } else {
          loadingTask = pdfjs.getDocument(`/api/pdfs/${pdfId}`);
        }
        const document = await loadingTask.promise; if (cancelled) return; setPdfPages(document.numPages);
        const page = await document.getPage(Math.min(Math.max(1, currentFloor.page), document.numPages)); if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        if (Math.abs(viewport.width - currentFloor.width) > .01 || Math.abs(viewport.height - currentFloor.height) > .01) {
          mutate(p => { const floorTarget = p.floors.find(f => f.id === currentFloor.id)!; floorTarget.width = viewport.width; floorTarget.height = viewport.height; });
        }
        const draw = async (renderPlanValue: PlanRender) => {
          const offscreen = window.document.createElement('canvas');
          offscreen.width = renderPlanValue.canvasWidth;
          offscreen.height = renderPlanValue.canvasHeight;
          const offscreenContext = offscreen.getContext('2d');
          if (!offscreenContext) throw new Error('canvas недоступен');
          renderTask = page.render({
            canvasContext: offscreenContext,
            viewport: page.getViewport({ scale: renderPlanValue.scale }),
            canvas: offscreen,
            transform: renderPlanValue.clipped
              ? [1, 0, 0, 1, -renderPlanValue.clipX * renderPlanValue.scale, -renderPlanValue.clipY * renderPlanValue.scale]
              : undefined,
          });
          await renderTask.promise;
          const current = canvas.current;
          if (!current) return;
          current.width = offscreen.width;
          current.height = offscreen.height;
          const context = current.getContext('2d');
          if (context) { context.clearRect(0, 0, current.width, current.height); context.drawImage(offscreen, 0, 0); }
          setRenderPlan(renderPlanValue);
          if (!renderPlanValue.clipped) pdfCache.current = { key, canvas: offscreen };
        };
        try {
          await draw(plan);
        } catch (error) {
          // Большой лист не удалось нарисовать по частям — рисуем целиком с ограничением разрешения.
          if (!plan.clipped) throw error;
          await draw(fallbackPlan(currentFloor.width, currentFloor.height, PLAN_MAX_PIXELS));
        }
      } catch (e) { if (!cancelled) setPdfError(`PDF не отображён: ${e instanceof Error ? e.message : String(e)}`); }
    })();
    return () => { cancelled = true; renderTask?.cancel(); loadingTask?.destroy(); };
  }, [floor?.pdfId, floor?.page, floor?.id, view, renderTick]);
  // Большие листы перерисовываются по видимой области после жеста (с задержкой).
  useEffect(() => {
    if (!floor?.pdfId || !needsClipping(floor.width, floor.height, window.devicePixelRatio || 1, PLAN_MAX_PIXELS)) return;
    const timer = setTimeout(() => setRenderTick(value => value + 1), 260);
    return () => clearTimeout(timer);
  }, [pan, zoom, floor?.pdfId]);

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
    if (active && active.type !== 'pan' && JSON.stringify(active.before) !== JSON.stringify(projectRef.current)) { setUndo(items => [...items.slice(-59), active.before]); setRedo([]); }
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
  type ObjectKind = 'equipment' | 'route' | 'cable';
  function uniqueNumber(base: string, used: Set<string>): string {
    let candidate = `${base}-копия`;
    let index = 2;
    while (used.has(candidate)) candidate = `${base}-копия ${index++}`;
    return candidate;
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
    const target = kind === 'equipment' ? source.equipment.find(e => e.id === id) : kind === 'route' ? source.routes.find(r => r.id === id) : source.cables.find(c => c.id === id);
    if (!target) return;
    const segmentIds = kind === 'route' ? (target as Route).segments.map(s => s.id) : [];
    const affected = source.cables.filter(c => kind === 'equipment' ? c.fromId === id || c.toId === id : kind === 'route' ? c.segmentIds.some(s => segmentIds.includes(s)) : false);
    const label = kind === 'equipment' ? 'оборудование' : kind === 'route' ? 'трассу' : 'кабель';
    if (!window.confirm(`Удалить ${label} ${target.number}?${affected.length ? ` Также будут удалены связанные кабели: ${affected.map(c => c.number).join(', ')}.` : ''}`)) return;
    // Фото лежат в IndexedDB отдельно от проекта: без явной очистки они остаются сиротами.
    const photoKeys = kind === 'equipment' ? orphanPhotoKeys(source, [id]) : [];
    mutate(p => {
      if (kind === 'equipment') p.equipment = p.equipment.filter(e => e.id !== id);
      if (kind === 'route') p.routes = p.routes.filter(r => r.id !== id);
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
    const label = value.kind === 'equipment' ? 'Оборудование' : value.kind === 'route' ? 'Трасса' : 'Кабель';
    const item = value.kind === 'equipment' ? project.equipment.find(e => e.id === value.id) : value.kind === 'route' ? project.routes.find(r => r.id === value.id) : project.cables.find(c => c.id === value.id);
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
    const target = equipment;
    if (!target) return;
    const key = uid();
    await idbPut('photo:' + key, await compressPhoto(file));
    mutate(p => { const item = p.equipment.find(eq => eq.id === target.id); if (item) item.photos = [...(item.photos || []), key]; });
    setMessage(`Фото прикреплено к ${target.number}${file.name ? `: ${file.name}` : ''}.`);
  }
  function removePhoto(key: string) {
    if (!equipment) return;
    const targetId = equipment.id;
    mutate(p => { const item = p.equipment.find(eq => eq.id === targetId); if (item) item.photos = (item.photos || []).filter(itemKey => itemKey !== key); });
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
  function clientCsv(p: Project): string {
    const specs = specifications(p);
    const rows: (string | number | null)[][] = [];
    rows.push(['Кабельный журнал']);
    rows.push(['Номер', 'Наименование', 'Марка', 'От', 'До', 'Количество', 'Итог одного, м', 'Итог всего, м', 'Полный']);
    for (const c of p.cables) {
      const r = calculateCable(p, c);
      const name = (id: string) => p.equipment.find(e => e.id === id)?.number || id;
      rows.push([c.number, c.name, c.brand, name(c.fromId), name(c.toId), c.quantity, r.total, r.total === null ? null : r.total * c.quantity, r.complete ? 'Да' : 'Нет']);
    }
    rows.push([]); rows.push(['Оборудование']); rows.push(['Тип', 'Модель', 'Этаж', 'Количество']);
    for (const g of specs.equipment) rows.push([g.type, g.model, g.floor, g.quantity]);
    rows.push([]); rows.push(['Кабели (сводно)']); rows.push(['Марка', 'Линий', 'Геометрия, м', 'Итого, м']);
    for (const g of specs.cables) rows.push([g.brand, g.lines, g.geometry, g.total]);
    rows.push([]); rows.push(['Инфраструктура']); rows.push(['Тип', 'Длина, м', 'Сегментов', 'Кабелей']);
    for (const g of specs.infrastructure) rows.push([g.type, g.length, g.segments, g.cables]);
    const cell = (v: string | number | null) => {
      let text = v === null ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    return '\uFEFF' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  }
  async function takeSnapshot(reason: string): Promise<void> {
    // История — вспомогательная функция: без IndexedDB проект всё равно сохраняется.
    try {
      const snapshot = clone(projectRef.current);
      const key = `${snapshot.id}:${Date.now()}`;
      await idbStorePut('snapshots', key, { key, createdAt: new Date().toISOString(), reason, project: snapshot });
      const keys = (await idbStoreKeys('snapshots'))
        .filter(item => item.startsWith(`${snapshot.id}:`))
        .sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1]));
      for (const stale of keys.slice(SNAPSHOT_LIMIT)) await idbStoreDelete('snapshots', stale);
    } catch {
      // хранилище недоступно — снимок просто не создаётся
    }
  }
  async function openHistory(): Promise<void> {
    setHistoryOpen(true);
    setSnapshots(null);
    try {
      const projectId = projectRef.current.id;
      const keys = (await idbStoreKeys('snapshots'))
        .filter(item => item.startsWith(`${projectId}:`))
        .sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1]));
      const list: SnapshotEntry[] = [];
      for (const key of keys) {
        const entry = await idbStoreGet<SnapshotEntry>('snapshots', key);
        if (entry) list.push(entry);
      }
      setSnapshots(list);
    } catch {
      setSnapshots([]);
      setError('История версий недоступна: хранилище браузера закрыто.');
    }
  }
  async function restoreSnapshot(key: string): Promise<void> {
    const entry = snapshots?.find(item => item.key === key);
    if (!entry) return;
    if (!window.confirm(`Восстановить проект от ${new Date(entry.createdAt).toLocaleString('ru-RU')}? Текущее состояние сохранится как снимок.`)) return;
    try { await takeSnapshot('перед восстановлением'); } catch { /* снимок не критичен */ }
    load(clone(entry.project), true);
    setHistoryOpen(false);
    setSnapshots(null);
    setMessage('Проект восстановлен из снимка.');
  }
  async function deleteSnapshot(key: string): Promise<void> {
    try { await idbStoreDelete('snapshots', key); } catch { /* уже удалён */ }
    setSnapshots(current => (current || []).filter(item => item.key !== key));
  }
  async function compressPhoto(file: File): Promise<Blob> {
    // Фото с телефона уменьшаем до 1600 px по длинной стороне: журнал не раздувается.
    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      bitmap.close();
      return blob || file;
    } catch {
      return file;
    }
  }
  async function capturePlan(floorItem: Floor): Promise<{ title: string; png: Uint8Array } | null> {
    try {
      const width = 1600;
      const height = Math.max(1, Math.round(width * floorItem.height / Math.max(1, floorItem.width)));
      const target = document.createElement('canvas');
      target.width = width;
      target.height = height;
      const context = target.getContext('2d');
      if (!context) return null;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      if (floorItem.pdfId) {
        try {
          const pdfjs = await import('pdfjs-dist');
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          const stored = floorItem.pdfId.startsWith('idb:') ? await idbGet(floorItem.pdfId.slice(4)) : null;
          const loading = stored
            ? pdfjs.getDocument({ data: await stored.arrayBuffer() })
            : pdfjs.getDocument(`/api/pdfs/${floorItem.pdfId}`);
          const pdfDocument = await loading.promise;
          const page = await pdfDocument.getPage(Math.min(Math.max(1, floorItem.page), pdfDocument.numPages));
          const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
          const layer = document.createElement('canvas');
          layer.width = Math.max(1, Math.round(viewport.width));
          layer.height = Math.max(1, Math.round(viewport.height));
          const layerContext = layer.getContext('2d');
          if (layerContext) await page.render({ canvasContext: layerContext, viewport, canvas: layer }).promise;
          context.drawImage(layer, 0, 0, width, height);
          void pdfDocument.destroy();
        } catch { /* план выгружается без подложки */ }
      }
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildPlanSvg(projectRef.current, floorItem));
      await image.decode();
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => target.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return { title: floorItem.name, png: new Uint8Array(await blob.arrayBuffer()) };
    } catch {
      return null;
    }
  }
  async function collectPlans(): Promise<{ title: string; png: Uint8Array }[]> {
    const plans: { title: string; png: Uint8Array }[] = [];
    for (const floorItem of projectRef.current.floors) {
      const hasContent = projectRef.current.equipment.some(item => item.floorId === floorItem.id)
        || projectRef.current.routes.some(route => route.segments.some(segment => segment.a.floorId === floorItem.id || segment.b.floorId === floorItem.id));
      if (!hasContent) continue;
      const plan = await capturePlan(floorItem);
      if (plan) plans.push(plan);
    }
    return plans;
  }
  async function collectPhotos(): Promise<JournalPhoto[]> {
    const assets: JournalPhoto[] = [];
    for (const item of projectRef.current.equipment) {
      for (const key of item.photos || []) {
        try {
          const blob = await idbGet('photo:' + key);
          if (!blob) continue;
          assets.push({ number: item.number, name: item.name, data: await blob.arrayBuffer(), mime: blob.type || 'image/jpeg' });
        } catch { /* фото недоступно — журнал всё равно выгружается */ }
      }
    }
    return assets;
  }
  async function printJournal() {
    const current = projectRef.current;
    const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('./export-pdf'), import('./export-fonts')]);
    const bytes = await buildJournalPdf(current, await loadJournalFonts(), { photos: await collectPhotos(), plans: await collectPlans() });
    nativeBridge()?.printPdf?.(current.name, bytesToBase64(bytes));
    setMessage('Открыт системный диалог печати: выберите принтер или «Сохранить в PDF».');
  }
  async function download(kind: 'csv' | 'xlsx' | 'pdf' | 'backup') {
    if (staticMode) {
      const current = projectRef.current;
      const fileName = `${current.name}.${kind === 'backup' ? 'json' : kind}`;
      let blob: Blob;
      if (kind === 'xlsx') {
        // Офлайн-таблицы: тот же набор листов, что отдаёт серверная версия.
        const { buildWorkbook } = await import('./export-xlsx');
        blob = new Blob([buildWorkbook(exportSheets(current)) as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else if (kind === 'pdf') {
        // Офлайн-PDF: pdf-lib + встроенный PT Sans, без сервера и системных шрифтов.
        const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('./export-pdf'), import('./export-fonts')]);
        blob = new Blob([await buildJournalPdf(current, await loadJournalFonts(), { photos: await collectPhotos(), plans: await collectPlans() }) as unknown as BlobPart], { type: 'application/pdf' });
      } else if (kind === 'backup') {
        const ids = [...new Set(current.floors.flatMap(f => f.pdfId && f.pdfId.startsWith('idb:') ? [f.pdfId.slice(4)] : []))];
        const pdfs: { id: string; name: string; dataBase64: string }[] = [];
        for (const id of ids) {
          const pdfBlob = await idbGet(id);
          if (pdfBlob) pdfs.push({ id: 'idb:' + id, name: 'plan.pdf', dataBase64: await blobToBase64(pdfBlob) });
        }
        const photoKeys = [...new Set(current.equipment.flatMap(item => item.photos || []))];
        const photos: { key: string; name: string; mime: string; dataBase64: string }[] = [];
        for (const key of photoKeys) {
          try {
            const photoBlob = await idbGet('photo:' + key);
            if (photoBlob) photos.push({ key, name: 'photo.jpg', mime: photoBlob.type || 'image/jpeg', dataBase64: await blobToBase64(photoBlob) });
          } catch { /* фото недоступно — копия всё равно выгружается */ }
        }
        blob = new Blob([JSON.stringify({ schemaVersion: 1, project: current, pdfs, photos })], { type: 'application/json' });
      } else {
        blob = new Blob([clientCsv(current)], { type: 'text/csv;charset=utf-8' });
      }
      const done: Record<string, string> = {
        csv: 'Экспорт CSV сохранён',
        xlsx: 'Таблицы Excel сохранены',
        pdf: 'Журнал PDF сохранён',
        backup: 'Резервная копия сохранена',
      };
      const savedPath = await saveBlobOnDevice(fileName, blob);
      if (savedPath) {
        setMessage(`${done[kind]}: ${savedPath}`);
        return;
      }
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage(`${done[kind].replace('сохранён', 'готов').replace('сохранены', 'готовы')}.`);
      return;
    }
    const current = await saveProject();
    const url = kind === 'backup' ? `/api/projects/${current.id}/backup` : `/api/projects/${current.id}/export?format=${kind}`;
    const response = await fetch(url); if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${current.name}.${kind === 'backup' ? 'json' : kind}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setMessage(kind === 'backup' ? 'Резервная копия с PDF выгружена.' : `Экспорт ${kind.toUpperCase()} готов.`);
  }
  const toolHints: Record<Tool, string> = { select: 'Выберите объект • тяните оборудование и узлы трассы', pan: 'Перетаскивайте план • колесо — масштаб', equipment: 'Клик на плане — добавить оборудование', route: 'Клики — вершины • Enter — завершить • Esc — отменить', calibrate: 'Укажите две точки известного размера на PDF', cable: 'Выбирайте сегменты по порядку от начала к концу', measure: 'Рулетка: две точки на плане → расстояние в метрах' };

  return <div className="app-shell">
    <header className="topbar"><button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen(v => !v)}>☰</button><div className="brand"><span className="brand-mark">A</span><div>AnOOPlan<small>кабельный план</small></div></div><div className="project-heading"><input aria-label="Название проекта" value={project.name} onChange={e => mutate(p => { p.name = e.target.value; })} /><span className={dirty ? 'save-indicator dirty' : 'save-indicator'}>{dirty ? '● Не сохранён' : '● Сохранён'}</span></div><div className="top-actions"><button className="desk-only" onClick={() => { if (mayLeave()) load(freshProject(), false); }}>Новый</button><button className="desk-only" disabled={busy} onClick={() => void run(async () => { setProjects(staticMode ? lsProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); })}>Открыть</button><button disabled={busy} title="Загрузить ранее экспортированный JSON-проект" onClick={() => restoreInput.current?.click()}>Загрузить</button><button className="primary" disabled={busy || (persisted && !dirty)} onClick={() => void run(async () => { await saveProject(); })}>{busy ? 'Подождите…' : persisted && !dirty ? 'Сохранено ✓' : 'Сохранить'}</button></div></header>
    <div className="commandbar"><div className="view-tabs">{([['plan', 'План'], ['journal', 'Журнал'], ['specs', 'Ведомости']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><div className="command-actions"><button className="desk-only" onClick={() => { if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>Учебный проект</button><button className="export-trigger" onClick={() => setExportOpen(true)}>Экспорт / копия ↓</button></div></div>
    {error && <div className="banner error" role="alert"><strong>Не удалось выполнить действие.</strong> {error}<button onClick={() => setError('')}>×</button></div>}
    <div className="workspace"><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="sidebar-title">Структура проекта <span>{project.floors.length} эт.</span></div><div className="structure-tabs">{([['floors', 'Этажи'], ['equipment', 'Оборуд.'], ['routes', 'Трассы'], ['cables', 'Кабели']] as const).map(([id, name]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{name}<span>{project[id].length}</span></button>)}</div>
      <div className="object-list" onPointerDown={listPressDown} onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}>{tab === 'floors' ? project.floors.map((f, i) => <button key={f.id} className={`object-row ${floor?.id === f.id ? 'selected' : ''}`} onClick={() => { setFloorId(f.id); setSelection(null); setMenuOpen(false); }}><span className="object-icon">{String(i + 1).padStart(2, '0')}</span><span><strong>{f.name}</strong><small>{f.pdfId ? `PDF · страница ${f.page}` : 'Без подложки'} · {f.elevation === null ? 'отметка не задана' : `${number(f.elevation)} м`}</small></span><i className={f.metersPerUnit ? 'dot calibrated' : 'dot'} /></button>) : tab === 'equipment' ? project.equipment.map(eq => <button key={eq.id} data-kind="equipment" data-id={eq.id} className={`object-row ${selection?.id === eq.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'equipment', id: eq.id }); setFloorId(eq.floorId); setView('plan'); setMenuOpen(false); }}><span className="object-icon equipment-icon">▣</span><span><strong>{eq.number}</strong><small>{eq.name}</small></span></button>) : tab === 'routes' ? project.routes.map(r => <button key={r.id} data-kind="route" data-id={r.id} className={`object-row ${selection?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'route', id: r.id }); if (r.segments[0]) setFloorId(r.segments[0].a.floorId); setView('plan'); setMenuOpen(false); }}><span className="object-icon route-icon">⌁</span><span><strong>{r.number} · {r.type}</strong><small>{r.segments.length} сегм.</small></span></button>) : project.cables.map(c => { const calc = cableCalcs.get(c.id)!; return <button key={c.id} data-kind="cable" data-id={c.id} className={`object-row ${selection?.id === c.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'cable', id: c.id }); setMenuOpen(false); }}><span className="object-icon cable-icon">↝</span><span><strong>{c.number} · {c.brand || c.name}</strong><small>{calc.complete ? `${number(calc.total)} м` : 'Неполный расчёт'}</small></span><i className={calc.complete ? 'dot calibrated' : 'dot warning'} /></button>; })}
      {project[tab].length === 0 && <div className="empty-list">Объектов пока нет.<br />Добавьте их на плане.</div>}</div>
      <div className="sidebar-actions">{tab === 'floors' ? <><button onClick={() => { const f = freshFloor(`Этаж ${project.floors.length + 1}`); mutate(p => p.floors.push(f)); setFloorId(f.id); setSelection(null); }}>＋ Добавить этаж</button><button onClick={() => upload.current?.click()} disabled={!floor || busy}>↑ Загрузить PDF</button></> : <button onClick={() => { setView('plan'); setTool(tab === 'equipment' ? 'equipment' : tab === 'routes' ? 'route' : 'cable'); }}>＋ {tab === 'equipment' ? 'Оборудование на плане' : tab === 'routes' ? 'Начертить трассу' : 'Создать кабель'}</button>}</div>
      <div className="sidebar-project"><button onClick={() => { setMenuOpen(false); if (mayLeave()) load(freshProject(), false); }}>＋ Новый проект</button><button disabled={busy} onClick={() => { setMenuOpen(false); void run(async () => { setProjects(staticMode ? lsProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); }); }}>📂 Открыть проект</button><button disabled={busy} onClick={() => { setMenuOpen(false); restoreInput.current?.click(); }}>⬆ Загрузить JSON</button><button onClick={() => { setMenuOpen(false); if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>📘 Учебный проект</button></div>
      <div className="project-health"><span className="eyebrow">КОНТРОЛЬ ДАННЫХ</span><strong>{issueCount ? `${issueCount} замечаний` : 'Проверка проекта'}</strong><small>Неизвестные отметки, масштаб и разрывы исключают итоговый метраж.</small><button onClick={() => setView('specs')}>Показать проверку →</button></div></aside>
      <main className="main-area">{view === 'plan' ? <div className="plan-view"><div className="drawing-toolbar"><div className="tool-group">{([['select', '↖', 'Выбор'], ['pan', '✥', 'Панорама'], ['equipment', '▣', 'Оборудование'], ['route', '⌁', 'Трасса'], ['cable', '↝', 'Кабель'], ['calibrate', '↔', 'Масштаб'], ['measure', '📏', 'Рулетка']] as const).map(([id, icon, label]) => <button key={id} title={label} className={tool === id ? 'active' : ''} onClick={() => { setTool(id); setDraft([]); setCalibration([]); setMeasure([]); }}><b>{icon}</b><span>{label}</span></button>)}</div><div className="tool-group history"><button title="Отменить Ctrl+Z" disabled={!undo.length} onClick={() => history(true)}>↶</button><button title="Повторить Ctrl+Shift+Z" disabled={!redo.length} onClick={() => history(false)}>↷</button></div></div>
      <div className="drawing-options"><label><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />Сетка</label><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Привязка</label><label><input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} />Ортогонально</label><label>Шаг<input className="mini-input" type="number" min="1" value={gridSize} onChange={e => setGridSize(Math.max(1, Number(e.target.value) || 1))} /></label><span className="grow" />{floor?.pdfId && <label>Страница <input className="mini-input" type="number" min="1" max={pdfPages || 9999} value={floor.page} onChange={e => { const page = Math.max(1, Math.min(pdfPages || 9999, Number(e.target.value) || 1)); if (page !== floor.page && window.confirm('Смена страницы сохраняет объекты и сбрасывает масштаб. Продолжить?')) mutate(p => { const f = p.floors.find(f => f.id === floor.id)!; f.page = page; f.metersPerUnit = null; }); }} /> / {pdfPages || '…'}</label>}<button onClick={fit}>Вписать</button><button onClick={() => changeZoom(zoom / 1.2)}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => changeZoom(zoom * 1.2)}>＋</button></div>
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
          {floor.pdfId ? <canvas ref={canvas} style={renderPlan ? { position: 'absolute', left: renderPlan.clipX, top: renderPlan.clipY, width: renderPlan.clipWidth, height: renderPlan.clipHeight } : { width: '100%', height: '100%' }} /> : <div className="no-pdf"><span>AnOOPlan / {floor.name.toUpperCase()}</span><p>Рабочее поле без PDF</p><small>{project.name.includes('Учеб') ? 'Синтетическая схема для проверки расчёта' : 'Загрузите план PDF и задайте масштаб по двум точкам'}</small></div>}
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
            {project.equipment.filter(eq => eq.floorId === floor.id).map(eq => <g data-object="equipment" data-id={eq.id} key={eq.id} transform={`translate(${eq.x},${eq.y})`} className={`equipment-symbol ${selection?.id === eq.id ? 'is-selected' : ''}`} onPointerDown={e => { if (pinching.current) return; if (tool === 'select') { setSelection({ kind: 'equipment', id: eq.id }); startDrag(e, 'equipment', eq.id); } else if (tool === 'route') { e.stopPropagation(); armTap(e, () => setDraft(points => { const p = { x: eq.x, y: eq.y }; const last = points[points.length - 1]; return ortho && last && last.x !== p.x && last.y !== p.y ? [...points, { x: p.x, y: last.y }, p] : [...points, p]; })); } else if (tool === 'cable') { e.stopPropagation(); armTap(e, () => { if (!cableFrom) { setCableFrom(eq.id); setMessage(`Начало: ${eq.number}. Коснитесь конечного устройства.`); } else if (cableTo !== eq.id) { setCableTo(eq.id); const res = findRoute(project, cableFrom, eq.id); if (res.error) { setCableSegments([]); setError(res.error); } else { setCableSegments(res.segmentIds); setMessage(`Конец: ${eq.number}. Маршрут построен автоматически: ${res.segmentIds.length} сегм.`); } } }); } }}>
              <circle r={16 / zoom} fill="transparent" /><rect x={-7 / zoom} y={-7 / zoom} width={14 / zoom} height={14 / zoom} rx={2 / zoom} strokeWidth={2 / zoom} /><path d={`M ${-3 / zoom} 0 H ${3 / zoom} M 0 ${-3 / zoom} V ${3 / zoom}`} stroke="#fff" strokeWidth={1.5 / zoom} pointerEvents="none" /><text x={11 / zoom} y={4 / zoom} fontSize={12 / zoom} className="svg-label">{eq.number}</text>
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
      </div><div className="tool-hint"><span>{toolHints[tool]}</span><small>Координаты PDF: {pointer ? `${number(pointer.x)}; ${number(pointer.y)}` : '—'}</small></div></div> : view === 'journal' ? <section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Кабельный журнал</h1><p>Расчёт по выбранным сегментам, высотам и запасам. Единица измерения — метр.</p></div><button className="primary" onClick={() => { setView('plan'); setTool('cable'); }}>＋ Кабель</button></div><div className="table-scroll"><table><thead><tr><th>Кабель / марка</th><th>От → до</th><th>Геометрия</th><th>Запас трасс</th><th>Запас кабеля</th><th>Концы</th><th>Итог / шт.</th><th>Кол.</th><th>Стоимость, ₽</th><th>Статус</th></tr></thead><tbody>{project.cables.map(c => { const calc = cableCalcs.get(c.id)!; return <tr key={c.id} className={selection?.id === c.id ? 'selected' : ''} onClick={() => setSelection({ kind: 'cable', id: c.id })}><td><strong>{c.number}</strong><small>{c.brand || c.name}</small></td><td>{project.equipment.find(e => e.id === c.fromId)?.number || '?'} → {project.equipment.find(e => e.id === c.toId)?.number || '?'}</td><td>{number(calc.geometry)}</td><td>{number(calc.routeReserve)}</td><td>{number(calc.cableReserve)}</td><td>{number(calc.endReserve)}</td><td><strong>{number(calc.total)}</strong></td><td>{c.quantity}</td><td>{calc.cost === null ? '—' : number(calc.cost)}</td><td><span className={`badge ${calc.complete ? 'good' : 'warn'}`}>{calc.complete ? 'Рассчитан' : 'Неполный'}</span></td></tr>; })}</tbody></table>{!project.cables.length && <div className="document-empty">Создайте кабель: выберите оборудование и упорядоченную цепочку сегментов на плане.</div>}</div><div className="document-summary"><strong>{totals.metersComplete ? `${number(totals.meters)} м` : "Метраж рассчитан не полностью"}</strong><span>{totals.costComplete ? `Стоимость: ${number(totals.cost)} ₽` : "Стоимость не рассчитана: задайте цены за метр"}</span></div><div className="document-note">Итог указан для одного кабеля. Количество применяется в ведомости. Неполные значения не подменяются нулём.</div></section> : <section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Ведомости и проверка</h1><p>Кабельная продукция и инфраструктура. Общие сегменты инфраструктуры учитываются один раз.</p></div></div><SpecificationTables value={specifications(project)} /><h2>Замечания к проекту</h2><IssueList value={issues} /><div className="document-note">Расчёт не заменяет проверку проектировщиком. PDF может содержать разные масштабы: калибруйте каждый этаж и страницу отдельно. Совмещение осей этажей выполняется вручную.</div></section>}</main>
      <aside className={`properties ${propsOpen ? 'open' : ''}`}><div className="properties-title">Свойства<span>{equipment ? 'ОБОРУДОВАНИЕ' : route ? 'ТРАССА' : cable ? 'КАБЕЛЬ' : 'ЭТАЖ'}</span><button className="properties-close" aria-label="Закрыть" onClick={() => setPropsOpen(false)}>×</button></div><div className="properties-content">{selection && (equipment || route || cable) ? <><div className="object-heading"><span className="eyebrow">{equipment ? 'ОБОРУДОВАНИЕ' : route ? 'КАБЕЛЬНАЯ ТРАССА' : 'КАБЕЛЬ'}</span><h2>{(equipment || route || cable)?.number}</h2></div>{itemField('Обозначение', 'number')}{!route && itemField('Наименование', 'name')}{(equipment || route) && itemField('Тип', 'type')}{equipment && <div className="chip-row">{['Камера', 'Шкаф', 'Коммутатор', 'Считыватель', 'Лоток'].map(value => <button key={value} className="chip" onClick={() => setItem('type', value)}>{value}</button>)}</div>}
      {equipment && <><label className="field">Этаж{floorSelect(equipment.floorId, value => setItem('floorId', value))}</label><div className="field-pair">{itemField('X, ед. PDF', 'x', true)}{itemField('Y, ед. PDF', 'y', true)}</div>{itemField('Высота от пола, м', 'height', true)}<p className="help">Пустая высота означает неизвестное значение. Для подводов кабеля задайте высоту явно, в том числе 0.</p><div className="section-label">Фотографии <span>{equipment.photos?.length || 0}</span></div><div className="photo-strip">{(equipment.photos || []).map(key => photoUrls[key] ? <div className="photo-card" key={key}><img src={photoUrls[key]} alt={`Фото ${equipment.number}`} /><button aria-label="Удалить фото" onClick={() => removePhoto(key)}>×</button></div> : null)}<button className="photo-add" onClick={() => photoInput.current?.click()}>＋ Фото</button><button className="photo-add" onClick={() => cameraInput.current?.click()}>📷 Снять</button></div><p className="help">Снимок монтажа хранится в проекте и попадает в JSON-копию вместе с PDF-планами.</p><details><summary>Дополнительные свойства</summary>{Object.entries(equipment.properties).map(([key, value]) => field(key, value, v => setItem('properties', { ...equipment.properties, [key]: v })))}<button onClick={() => { const key = window.prompt('Название свойства'); if (key) setItem('properties', { ...equipment.properties, [key]: '' }); }}>＋ Свойство</button></details></>}
      {route && <><div className="section-label">Сегменты <span>{route.segments.length}</span></div><p className="help">Вершины тянутся на плане. Координаты и высоты можно задать точно ниже. При ручном изменении согласуйте соседние вершины.</p>{route.segments.map((s, index) => <details className="segment-editor" key={s.id}><summary>Сегмент {route.number}.{index + 1} {s.a.floorId !== s.b.floorId ? ' · стояк ↕' : ''}</summary><label className="field">Геометрия<select value={s.mode} onChange={e => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(segment => segment.id === s.id)!.mode = e.target.value as Segment['mode']; })}><option value="orthogonal">Ортогональная</option><option value="spatial">Пространственная</option></select></label>{(['a', 'b'] as const).map(end => <div className="endpoint" key={end}><strong>{end === 'a' ? 'Начало' : 'Конец'}</strong><label className="field">Этаж{floorSelect(s[end].floorId, value => segmentField(s, end, 'floorId', value))}</label><div className="field-pair">{field('X', s[end].x, v => segmentField(s, end, 'x', Number(v)), true)}{field('Y', s[end].y, v => segmentField(s, end, 'y', Number(v)), true)}</div>{field('Высота, м', s[end].height, v => segmentField(s, end, 'height', v === '' ? null : Number(v)), true)}</div>)}<div className="field-pair">{field('Запас, %', s.reservePercent, v => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(seg => seg.id === s.id)!.reservePercent = Number(v); }), true)}{field('Запас, м', s.reserveFixed, v => mutate(p => { p.routes.find(r => r.id === route.id)!.segments.find(seg => seg.id === s.id)!.reserveFixed = Number(v); }), true)}</div><button className="danger" onClick={() => { const linked = project.cables.filter(c => c.segmentIds.includes(s.id)); if (window.confirm(`Удалить сегмент? ${linked.length ? `Связанных кабелей: ${linked.length}. Они будут удалены.` : ''}`)) mutate(p => { p.routes.find(r => r.id === route.id)!.segments = p.routes.find(r => r.id === route.id)!.segments.filter(seg => seg.id !== s.id); p.cables = p.cables.filter(c => !c.segmentIds.includes(s.id)); }); }}>Удалить сегмент</button></details>)}<button className="wide" onClick={addRiser}>＋ Межэтажный стояк</button></>}
      {cable && <>{itemField('Марка', 'brand')}{itemField('Назначение', 'purpose')}<label className="field">От{equipmentSelect(cable.fromId, value => setItem('fromId', value))}</label><label className="field">До{equipmentSelect(cable.toId, value => setItem('toId', value))}</label><div className="field-pair">{itemField('Запас, %', 'reservePercent', true)}{itemField('Запас, м', 'reserveFixed', true)}</div><div className="field-pair">{itemField('На начале, м', 'startReserve', true)}{itemField('На конце, м', 'endReserve', true)}</div>{itemField('Количество', 'quantity', true)}{itemField('Цена за метр, ₽', 'pricePerMeter', true)}<div className="section-label">Порядок обхода</div><ol className="segment-order">{cable.segmentIds.map((id, i) => <li key={id}><span>{segmentName(id)}</span><button disabled={!i} title="Выше" onClick={() => { const next = [...cable.segmentIds]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setItem('segmentIds', next); }}>↑</button><button disabled={i === cable.segmentIds.length - 1} title="Ниже" onClick={() => { const next = [...cable.segmentIds]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setItem('segmentIds', next); }}>↓</button><button title="Удалить из цепочки" onClick={() => setItem('segmentIds', cable.segmentIds.filter(s => s !== id))}>×</button></li>)}</ol><button className="wide" onClick={() => { setCableSegments([...cable.segmentIds]); setCableFrom(cable.fromId); setCableTo(cable.toId); setTool('cable'); setView('plan'); setMessage('Измените цепочку кликами. Кнопка «Применить» в свойствах сохранит выбор.'); }}>Выбрать сегменты на плане</button>{tool === 'cable' && <button className="primary wide" onClick={() => { setItem('segmentIds', [...cableSegments]); setItem('fromId', cableFrom); setItem('toId', cableTo); setTool('select'); setCableSegments([]); }}>Применить цепочку к {cable.number}</button>}{calculation && <div className={`calculation-card ${calculation.complete ? '' : 'incomplete'}`}><span>ИТОГ / 1 КАБЕЛЬ</span><strong>{number(calculation.total)} <small>м</small></strong><dl><dt>Геометрия</dt><dd>{number(calculation.geometry)} м</dd><dt>Запас трассы</dt><dd>{number(calculation.routeReserve)} м</dd><dt>Запас кабеля</dt><dd>{number(calculation.cableReserve)} м</dd><dt>Запас концов</dt><dd>{number(calculation.endReserve)} м</dd></dl>{calculation.errors.map((e, i) => <p key={i}>{e}</p>)}</div>}</>}
      <label className="field">Примечание<textarea value={(equipment || route || cable)?.note || ''} onChange={e => setItem('note', e.target.value)} /></label><div className="property-actions"><button onClick={copySelection}>Копировать</button><button className="danger" onClick={removeSelection}>Удалить</button></div></> : floor ? <><div className="object-heading"><span className="eyebrow">ТЕКУЩИЙ ЭТАЖ</span><h2>{floor.name}</h2></div>{field('Название', floor.name, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.name = v; }))}{field('Отметка пола, м', floor.elevation, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.elevation = v === '' ? null : Number(v); }), true, 'Абсолютная отметка для расчёта межэтажных стояков.')}<div className="scale-card"><span className="eyebrow">МАСШТАБ ПОДЛОЖКИ</span><strong>{floor.metersPerUnit ? `${number(floor.metersPerUnit)} м/ед.` : 'Не откалиброван'}</strong><button onClick={() => { setTool('calibrate'); setView('plan'); setCalibration([]); }}>↔ Калибровка по 2 точкам</button></div><details className="scale-presets"><summary>Масштаб по формату листа</summary><div className="field-pair"><label className="field">Формат<select value={sheetFormat} onChange={e => setSheetFormat(e.target.value)}>{Object.keys(SHEET_SIZES).map(size => <option key={size} value={size}>{size}</option>)}</select></label><label className="field">Масштаб<select value={sheetScale} onChange={e => setSheetScale(e.target.value)}>{['50', '100', '200', '500'].map(value => <option key={value} value={value}>1:{value}</option>)}</select></label></div><button className="wide" onClick={applySheetScale}>Применить масштаб листа</button><p className="help">Если план — стандартный лист {sheetFormat} в масштабе 1:{sheetScale}, калибровка двумя точками не нужна.</p></details>{field('Метров в единице PDF', floor.metersPerUnit, v => mutate(p => { p.floors.find(f => f.id === floor.id)!.metersPerUnit = v === '' ? null : Number(v); }), true)}<div className="section-label">Подложка</div><p className="help">{floor.pdfId ? `Исходный PDF подключён. Страница ${floor.page}; ${number(floor.width)} × ${number(floor.height)} ед.` : 'PDF не загружен. Можно чертить на чистом листе; для метража необходим масштаб.'}</p>{floor.pdfId && pdfPages > 0 && <label className="field mobile-only">Страница PDF<input type="number" min="1" max={pdfPages} value={floor.page} onChange={e => { const page = Math.max(1, Math.min(pdfPages, Number(e.target.value) || 1)); if (page !== floor.page) mutate(p => { const f = p.floors.find(f => f.id === floor.id)!; f.page = page; f.metersPerUnit = null; }); }} /></label>}<button className="wide" disabled={busy} onClick={() => upload.current?.click()}>↑ {floor.pdfId ? 'Заменить PDF…' : 'Загрузить PDF…'}</button><p className="help">При замене PDF или страницы объекты остаются на прежних координатах. Проверьте положение и повторите калибровку.</p><div className="section-label">Система координат</div><p className="help">X/Y хранятся в единицах PDF. Зум не влияет на длины. Для стояка совпадающие X/Y на разных этажах должны соответствовать одной физической оси.</p><button className="danger wide" disabled={project.floors.length < 2} onClick={() => { const eqIds = project.equipment.filter(eq => eq.floorId === floor.id).map(eq => eq.id); const segmentIds = project.routes.flatMap(r => r.segments).filter(s => s.a.floorId === floor.id || s.b.floorId === floor.id).map(s => s.id); if (window.confirm('Удалить этаж, его оборудование, связанные сегменты и кабели?')) { const photoKeys = orphanPhotoKeys(project, eqIds); mutate(p => { p.floors = p.floors.filter(f => f.id !== floor.id); p.equipment = p.equipment.filter(eq => eq.floorId !== floor.id); p.routes.forEach(r => { r.segments = r.segments.filter(s => !segmentIds.includes(s.id)); }); p.routes = p.routes.filter(r => r.segments.length); p.cables = p.cables.filter(c => !eqIds.includes(c.fromId) && !eqIds.includes(c.toId) && !c.segmentIds.some(id => segmentIds.includes(id))); }); void purgePhotoBlobs(photoKeys, idbDelete); setFloorId(''); } }}>Удалить этаж</button></> : <p className="help">Добавьте этаж для начала работы.</p>}</div></aside>
    </div><footer className="statusbar"><span><i className="dot calibrated" />{message}</span><span>{project.equipment.length} оборуд. · {project.routes.length} трасс · {project.cables.length} кабелей <b>{staticMode ? 'БРАУЗЕР' : 'СЕРВЕР'}</b></span></footer>
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
    <input hidden ref={restoreInput} type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file && mayLeave()) void run(async () => { const parsed = JSON.parse(await file.text()) as Record<string, unknown>; if (staticMode) { const proj = (parsed && typeof parsed === 'object' && 'project' in parsed) ? parsed.project : parsed; if (proj && (proj as Partial<Project>).schemaVersion === 1 && Array.isArray((proj as Partial<Project>).floors)) { const rawPdfs = (parsed && typeof parsed === 'object' && 'pdfs' in parsed && Array.isArray(parsed.pdfs)) ? parsed.pdfs as { id: string; dataBase64?: string }[] : []; for (const pdf of rawPdfs) { if (pdf && pdf.id && pdf.dataBase64) { const bytes = Uint8Array.from(atob(pdf.dataBase64), c => c.charCodeAt(0)); await idbPut(pdf.id.replace(/^idb:/, ''), new Blob([bytes], { type: 'application/pdf' })); } }
        const rawPhotos = (parsed && typeof parsed === 'object' && 'photos' in parsed && Array.isArray((parsed as { photos?: unknown }).photos)) ? (parsed as { photos: { key?: string; dataBase64?: string; mime?: string }[] }).photos : [];
        for (const photo of rawPhotos) { if (photo && photo.key && photo.dataBase64) { const bytes = Uint8Array.from(atob(photo.dataBase64), c => c.charCodeAt(0)); await idbPut('photo:' + photo.key, new Blob([bytes], { type: photo.mime || 'image/jpeg' })); } } load(proj as unknown as Project, true); setMessage('Проект загружен из файла.'); } else { setError('Файл не является проектом AnOOPlan.'); } } else if (parsed && typeof parsed === 'object' && 'project' in parsed) { const result = await api<Project>('/api/restore', jsonOptions('POST', parsed)); load(result, true); setMessage('Резервная копия с PDF восстановлена.'); } else if (parsed && (parsed as Partial<Project>).schemaVersion === 1 && Array.isArray((parsed as Partial<Project>).floors)) { load(parsed as unknown as Project, false); setMessage('Проект загружен из файла. Подложку PDF при необходимости загрузите заново.'); } else { setError('Файл не является проектом или резервной копией AnOOPlan.'); } }); e.target.value = ''; }} />
    {projects && <div className="modal-backdrop"><section className="modal"><div className="modal-heading"><h2>Открыть проект</h2><button onClick={() => setProjects(null)}>×</button></div>{projects.length ? projects.map(p => <div className="project-row" key={p.id}><button className="project-option" disabled={busy} onClick={() => { if (mayLeave()) void run(async () => { const result = staticMode ? lsProjects().find(x => x.id === p.id)! : await api<Project>(`/api/projects/${p.id}`); load(result, true); setProjects(null); setMessage(`Проект «${result.name}» открыт.`); }); }}><strong>{p.name}</strong><small>{new Date(p.updatedAt).toLocaleString('ru-RU')}</small><span>→</span></button><button className="project-delete" disabled={busy} title="Удалить проект" onClick={() => void run(() => deleteProject(p.id, p.name))}>🗑</button></div>) : <p className="help">Сохранённых проектов пока нет.</p>}</section></div>}
  </div>;
}

function IssueList({ value }: { value: unknown }) {
  if (Array.isArray(value)) return value.length ? <ul className="issues-list">{value.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul> : <div className="validation-good">✓ Структурных замечаний не найдено. Проверьте рабочую документацию перед применением.</div>;
  return <pre className="data-json">{JSON.stringify(value, null, 2)}</pre>;
}
const labels: Record<string, string> = { cables: 'Кабельная продукция', cable: 'Кабельная продукция', infrastructure: 'Кабельная инфраструктура', routes: 'Кабельная инфраструктура', errors: 'Замечания', warnings: 'Предупреждения', name: 'Наименование', brand: 'Марка', type: 'Тип', purpose: 'Назначение', number: 'Обозначение', quantity: 'Количество', length: 'Длина, м', total: 'Всего, м', totalLength: 'Всего, м', complete: 'Полный расчёт', unit: 'Ед.', routeId: 'ID трассы', cableId: 'ID кабеля', segmentId: 'ID сегмента', reserve: 'Запас', geometry: 'Геометрия, м', totalQuantity: 'Количество', totalMeters: 'Всего, м', incomplete: 'Неполные', id: 'ID' };
function SpecificationTables({ value }: { value: unknown }) {
  function render(data: unknown, key: string): React.ReactNode {
    if (Array.isArray(data)) {
      if (!data.length) return <p className="help">Нет данных.</p>;
      if (data.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) {
        const rows = data as Record<string, unknown>[]; const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
        return <div className="table-scroll"><table><thead><tr>{columns.map(col => <th key={col}>{labels[col] || col}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(col => <td key={col}>{typeof row[col] === 'number' ? number(row[col]) : typeof row[col] === 'boolean' ? row[col] ? 'Да' : 'Нет' : row[col] === null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '—')}</td>)}</tr>)}</tbody></table></div>;
      }
      return <IssueList value={data} />;
    }
    if (data && typeof data === 'object') return <>{Object.entries(data).map(([name, item]) => <section className="spec-section" key={name}><h2>{labels[name] || name}</h2>{render(item, name)}</section>)}</>;
    return <div className="spec-value" style={{ '--spec-key': key } as CSSProperties}>{typeof data === 'number' ? number(data) : String(data ?? '—')}</div>;
  }
  return <div className="specifications">{render(value, 'root')}</div>;
}
