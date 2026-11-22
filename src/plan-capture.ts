import workerUrl from './pdf-worker?worker&url';
import type { Floor, Project } from './model';
import type { JournalPhoto } from './export-pdf';
import { buildPlanSvg } from './plan-svg';
import { decodeImage } from './compat';
import { logDiagnostic } from './diagnostics';
import { idbGet } from './idb';
import type { PlanSheet } from './plan-pages';
import { groupFloorsByPdf, planFloors, planSheetsForPdf } from './plan-pages';
import { planRasterWidth } from './plan-raster';

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

/** Освобождает растр канваса сразу после сборки PNG, чтобы не держать страницы в памяти. */
function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
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
  const plan = await canvasToPlan(surface.canvas, floor.name);
  releaseCanvas(surface.canvas);
  return plan;
}

/** Один лист: PDF-страница и оверлей этажа, если он назначен раскладкой. */
async function captureSheet(project: Project, document: PdfDocument, sheet: PlanSheet): Promise<CapturedPlan | null> {
  const page = await document.getPage(sheet.page);
  const viewport = page.getViewport({ scale: 1 });
  const floor = sheet.floor;
  const width = planRasterWidth(floor ? floor.width : viewport.width, floor ? floor.height : viewport.height);
  const height = Math.max(1, Math.round(floor
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
    releaseCanvas(layer.canvas);
  }
  if (floor) await drawOverlay(surface.canvas, project, floor);
  const plan = await canvasToPlan(surface.canvas, sheet.title);
  if (plan && sheet.note) plan.note = sheet.note;
  releaseCanvas(surface.canvas);
  return plan;
}

function mergeWarnings(target: string[], items: readonly string[]): void {
  for (const item of items) {
    if (!target.includes(item)) target.push(item);
  }
}

/**
 * Листы одной группы этажей с общим PDF: документ читается один раз,
 * каждая страница рендерится один раз (раскладка `planSheetsForPdf` даёт
 * не больше одной записи на страницу), оверлей наносится на нужной странице.
 */
async function captureFloorGroup(project: Project, pdfId: string, floors: Floor[]): Promise<PlanCaptureResult> {
  let pdf: { document: PdfDocument; destroy: () => void } | null = null;
  try {
    pdf = await loadPdfDocument(pdfId);
    const layout = planSheetsForPdf(floors, pdf.document.numPages);
    const plans: CapturedPlan[] = [];
    const warnings: string[] = [];
    mergeWarnings(warnings, layout.warnings);
    // Страховка от повторной отрисовки: раскладка уникальна по страницам.
    const renderedPages = new Set<number>();
    for (const sheet of layout.sheets) {
      if (renderedPages.has(sheet.page)) continue;
      renderedPages.add(sheet.page);
      try {
        const plan = await captureSheet(project, pdf.document, sheet);
        if (plan) {
          plans.push(plan);
          continue;
        }
      } catch (error) {
        logDiagnostic('error', error, `capturePlan:page:${sheet.page}`);
      }
      const failure = sheet.floor
        ? `Этаж «${sheet.floor.name}»: не удалось отрисовать страницу ${sheet.page}.`
        : `Лист ${sheet.page}: не удалось отрисовать страницу PDF.`;
      mergeWarnings(warnings, [failure]);
      // Оверлей этажа не должен потеряться: печатаем белый лист с ним.
      if (sheet.floor) {
        const fallback = await fallbackPlan(project, sheet.floor);
        if (fallback) plans.push(fallback);
      }
    }
    if (!plans.length) {
      for (const floor of floors) {
        const fallback = await fallbackPlan(project, floor);
        if (fallback) plans.push(fallback);
        mergeWarnings(warnings, [`Этаж «${floor.name}»: PDF не удалось отрисовать, выгружен лист без подложки.`]);
      }
    }
    return { plans, warnings };
  } catch (error) {
    logDiagnostic('error', error, 'capturePlan:pdf');
    const plans: CapturedPlan[] = [];
    const warnings: string[] = [];
    for (const floor of floors) {
      const fallback = await fallbackPlan(project, floor);
      if (fallback) plans.push(fallback);
      mergeWarnings(warnings, [`Этаж «${floor.name}»: PDF не удалось прочитать, выгружен лист без подложки.`]);
    }
    return { plans, warnings };
  } finally {
    pdf?.destroy();
  }
}

/**
 * Листы «План» для этажей с оборудованием, трассами или пинами. Этажи с общим
 * PDF собираются в группу: документ читается и каждая страница рендерится один раз.
 */
export async function collectPlans(project: Project, onProgress?: (done: number, total: number) => void): Promise<PlanCaptureResult> {
  const floors = planFloors(project);
  const plans: CapturedPlan[] = [];
  const warnings: string[] = [];
  let done = 0;
  for (const group of groupFloorsByPdf(floors)) {
    onProgress?.(done, floors.length);
    if (group.pdfId === null) {
      for (const floor of group.floors) {
        const plan = await fallbackPlan(project, floor);
        if (plan) plans.push(plan);
        done += 1;
        onProgress?.(done, floors.length);
      }
      continue;
    }
    const result = await captureFloorGroup(project, group.pdfId, group.floors);
    plans.push(...result.plans);
    mergeWarnings(warnings, result.warnings);
    done += group.floors.length;
    onProgress?.(done, floors.length);
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
