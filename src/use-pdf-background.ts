import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import workerUrl from './pdf-worker?worker&url';
import type { Floor, Project } from './model';
import { planRender, fallbackPlan, needsClipping, type PlanRender } from './render-plan';
import { logDiagnostic } from './diagnostics';
import { idbGet } from './idb';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfLoadingTask = ReturnType<PdfjsModule['getDocument']>;
type PdfRenderTask = ReturnType<import('pdfjs-dist/legacy/build/pdf.mjs').PDFPageProxy['render']>;

// Бюджет пикселей подложки: A4-A3 рисуются целиком, A1-A0 — по видимой области.
const PLAN_MAX_PIXELS = 12_000_000;

interface Options {
  floor: Floor | undefined;
  enabled: boolean;
  viewRef: MutableRefObject<{ zoom: number; pan: { x: number; y: number } }>;
  zoom: number;
  pan: { x: number; y: number };
  canvas: MutableRefObject<HTMLCanvasElement | null>;
  stage: MutableRefObject<HTMLDivElement | null>;
  mutate: (fn: (project: Project) => void) => void;
}

/**
 * Рендер PDF-подложки в canvas: полный лист или видимая область для A1/A0.
 * Состояние и кэш живут здесь, App получает только страницы, план рендера и ошибку.
 */
export function usePdfBackground({ floor, enabled, viewRef, zoom, pan, canvas, stage, mutate }: Options) {
  const [pdfPages, setPdfPages] = useState(0);
  const [renderPlan, setRenderPlan] = useState<PlanRender | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [renderTick, setRenderTick] = useState(0);
  const pdfCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  useEffect(() => { setPdfPages(0); setPdfError(''); }, [floor?.id, floor?.pdfId]);

  useEffect(() => {
    if (!floor?.pdfId || !enabled) return;
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
    const target = canvas.current;
    if (!target) return;
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
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        if (pdfId.startsWith('idb:')) {
          const blob = await idbGet(pdfId.slice(4));
          if (!blob) throw new Error('PDF не найден в хранилище браузера');
          loadingTask = pdfjs.getDocument({ data: await blob.arrayBuffer() });
        } else if (pdfId.startsWith('data:')) {
          const base64 = pdfId.slice(pdfId.indexOf(',') + 1);
          loadingTask = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), c => c.charCodeAt(0)) });
        } else {
          loadingTask = pdfjs.getDocument({ url: `/api/pdfs/${pdfId}` });
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
          if (!plan.clipped) throw error;
          await draw(fallbackPlan(currentFloor.width, currentFloor.height, PLAN_MAX_PIXELS));
        }
      } catch (error) {
        logDiagnostic('error', error, 'renderPlan');
        if (!cancelled) setPdfError(`PDF не отображён: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => { cancelled = true; renderTask?.cancel(); loadingTask?.destroy(); };
  }, [floor?.pdfId, floor?.page, floor?.id, enabled, renderTick]);

  // Большие листы перерисовываются по видимой области после жеста (с задержкой).
  useEffect(() => {
    if (!floor?.pdfId || !needsClipping(floor.width, floor.height, window.devicePixelRatio || 1, PLAN_MAX_PIXELS)) return;
    const timer = setTimeout(() => setRenderTick(value => value + 1), 260);
    return () => clearTimeout(timer);
  }, [floor?.pdfId, floor?.width, floor?.height, pan, zoom]);

  return { pdfPages, renderPlan, pdfError, setPdfError };
}
