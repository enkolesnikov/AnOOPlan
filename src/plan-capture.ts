import workerUrl from './pdf-worker?worker&url';
import type { Floor, Project } from './model';
import type { JournalPhoto } from './export-pdf';
import { buildPlanSvg } from './plan-svg';
import { decodeImage } from './compat';
import { logDiagnostic } from './diagnostics';
import { idbGet } from './idb';
import { MAX_PLAN_PAGES, planOverlayWarning, planPageTitle, planPagesToCapture } from './plan-pages';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfLoadingTask = ReturnType<PdfjsModule['getDocument']>;
type PdfDocument = Awaited<PdfLoadingTask['promise']>;

export interface CapturedPlan {
  title: string;
  png: Uint8Array;
  /** Пояснение на листе PDF (например, почему не нанесён оверлей этажа). */
  note?: string;
}

export interface PlanCaptureResult {
  plans: CapturedPlan[];
  warnings: string[];
}


function canvasContext(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
}

async function loadPdfDocument(pdfId: string): Promise<{ document: PdfDocument; destroy: () => void }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let loading: PdfLoadingTask;
  if (pdfId.startsWith('idb:')) {
    const stored = await idbGet(pdfId.slice(4));
    if (!stored) throw new Error('PDF не найден в хранилище браузера');
    loading = pdfjs.getDocument({ data: await stored.arrayBuffer() });
  } else if (pdfId.startsWith('data:')) {
    loading = pdfjs.getDocument({ data: Uint8Array.from(atob(pdfId.slice(pdfId.indexOf(',') + 1)), c => c.charCodeAt(0)) });
  } else {
    loading = pdfjs.getDocument({ url: `/api/pdfs/${pdfId}` });
  }
  const document = await loading.promise;
  return { document, destroy: () => void loading.destroy() };
}

async function drawOverlay(canvas: HTMLCanvasElement, project: Project, floor: Floor): Promise<void> {
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildPlanSvg(project, floor));
  await decodeImage(image);
  const context = canvas.getContext('2d');
  if (context) context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

async function canvasToPlan(canvas: HTMLCanvasElement, title: string): Promise<CapturedPlan | null> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return { title, png: new Uint8Array(await blob.arrayBuffer()) };
}

/** План без PDF: белый лист и только SVG-оверлей. */
async function fallbackPlan(project: Project, floor: Floor): Promise<CapturedPlan | null> {
  const width = 1600;
  const height = Math.max(1, Math.round(width * floor.height / Math.max(1, floor.width)));
  const surface = canvasContext(width, height);
  if (!surface) return null;
  surface.context.fillStyle = '#ffffff';
  surface.context.fillRect(0, 0, width, height);
  await drawOverlay(surface.canvas, project, floor);
  return canvasToPlan(surface.canvas, planPageTitle(floor.name, 1, 1));
}

/** Один лист: PDF-страница + оверлей только для откалиброванной страницы этажа. */
async function capturePage(project: Project, floor: Floor, document: PdfDocument, pageNumber: number): Promise<CapturedPlan | null> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const width = 1600;
  const active = pageNumber === floor.page;
  const height = Math.max(1, Math.round(active
    ? width * floor.height / Math.max(1, floor.width)
    : width * viewport.height / Math.max(1, viewport.width)));
  const surface = canvasContext(width, height);
  if (!surface) return null;
  surface.context.fillStyle = '#ffffff';
  surface.context.fillRect(0, 0, width, height);

  const layer = canvasContext(width, width * viewport.height / Math.max(1, viewport.width));
  if (layer) {
    const renderTask = page.render({
      canvasContext: layer.context,
      viewport: page.getViewport({ scale: width / viewport.width }),
      canvas: layer.canvas,
    });
    await renderTask.promise;
    surface.context.drawImage(layer.canvas, 0, 0, width, height);
  }
  if (active) await drawOverlay(surface.canvas, project, floor);
  return canvasToPlan(surface.canvas, planPageTitle(floor.name, pageNumber, document.numPages));
}

/**
 * Все страницы PDF этажа (до MAX_PLAN_PAGES). Оверлей трасс/оборудования
 * наносится только на `floor.page`; остальные листы остаются чистой подложкой.
 */
export async function capturePlanPages(project: Project, floor: Floor): Promise<PlanCaptureResult> {
  if (!floor.pdfId) {
    const plan = await fallbackPlan(project, floor);
    return { plans: plan ? [plan] : [], warnings: [] };
  }
  const warnings: string[] = [];
  let pdf: { document: PdfDocument; destroy: () => void } | null = null;
  try {
    pdf = await loadPdfDocument(floor.pdfId);
    const pageCount = pdf.document.numPages;
    const total = planPagesToCapture(pageCount);
    if (pageCount > MAX_PLAN_PAGES) {
      warnings.push(`Этаж «${floor.name}»: показаны первые ${MAX_PLAN_PAGES} страниц из ${pageCount}.`);
    }
    const overlayWarning = planOverlayWarning(floor.name, floor.page, pageCount, total);
    if (overlayWarning) warnings.push(overlayWarning);
    const plans: CapturedPlan[] = [];
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      try {
        const plan = await capturePage(project, floor, pdf.document, pageNumber);
        if (plan) {
          if (overlayWarning) plan.note = overlayWarning;
          plans.push(plan);
        }
      } catch (error) {
        logDiagnostic('error', error, `capturePlan:page:${pageNumber}`);
        warnings.push(`Этаж «${floor.name}»: не удалось отрисовать страницу ${pageNumber}.`);
      }
    }
    if (!plans.length) {
      const fallback = await fallbackPlan(project, floor);
      if (fallback) plans.push(fallback);
      warnings.push(`Этаж «${floor.name}»: PDF не удалось отрисовать, выгружен лист без подложки.`);
    }
    return { plans, warnings };
  } catch (error) {
    logDiagnostic('error', error, 'capturePlan:pdf');
    const fallback = await fallbackPlan(project, floor);
    return { plans: fallback ? [fallback] : [], warnings: [`Этаж «${floor.name}»: PDF не удалось прочитать, выгружен лист без подложки.`] };
  } finally {
    pdf?.destroy();
  }
}

/** Листы «План» только для этажей, где есть оборудование или трассы. */
export async function collectPlans(project: Project, onProgress?: (done: number, total: number) => void): Promise<PlanCaptureResult> {
  const floors = project.floors.filter(floorItem =>
    project.equipment.some(item => item.floorId === floorItem.id)
    || project.routes.some(route => route.segments.some(segment => segment.a.floorId === floorItem.id || segment.b.floorId === floorItem.id)));
  const plans: CapturedPlan[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < floors.length; index += 1) {
    onProgress?.(index, floors.length);
    const result = await capturePlanPages(project, floors[index]);
    plans.push(...result.plans);
    warnings.push(...result.warnings);
  }
  onProgress?.(floors.length, floors.length);
  return { plans, warnings };
}

/** Фотографии замечаний для PDF, с подписями. */
export async function collectPinPhotos(project: Project): Promise<JournalPhoto[]> {
  const assets: JournalPhoto[] = [];
  for (const pin of project.pins ?? []) {
    for (const key of pin.photos || []) {
      try {
        const blob = await idbGet('photo:' + key);
        if (!blob) continue;
        assets.push({ number: pin.number, name: pin.comment || 'Замечание', data: await blob.arrayBuffer(), mime: blob.type || 'image/jpeg' });
      } catch { /* фото недоступно — журнал всё равно выгружается */ }
    }
  }
  return assets;
}

/** Фотографии оборудования для PDF, с подписями. */
export async function collectPhotos(project: Project): Promise<JournalPhoto[]> {
  const assets: JournalPhoto[] = [];
  for (const item of project.equipment) {
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
