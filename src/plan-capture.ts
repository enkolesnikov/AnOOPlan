import workerUrl from './pdf-worker?worker&url';
import type { Floor, Project } from './model';
import type { JournalPhoto } from './export-pdf';
import { buildPlanSvg } from './plan-svg';
import { decodeImage } from './compat';
import { logDiagnostic } from './diagnostics';
import { idbGet } from './idb';

export interface CapturedPlan {
  title: string;
  png: Uint8Array;
}

/** Растровый лист «План»: белый лист + PDF-подложка + прозрачный SVG-оверлей. */
export async function capturePlan(project: Project, floorItem: Floor): Promise<CapturedPlan | null> {
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
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const stored = floorItem.pdfId.startsWith('idb:') ? await idbGet(floorItem.pdfId.slice(4)) : null;
        const loading = stored
          ? pdfjs.getDocument({ data: await stored.arrayBuffer() })
          : floorItem.pdfId.startsWith('data:')
            ? pdfjs.getDocument({ data: Uint8Array.from(atob(floorItem.pdfId.slice(floorItem.pdfId.indexOf(',') + 1)), c => c.charCodeAt(0)) })
            : pdfjs.getDocument({ url: `/api/pdfs/${floorItem.pdfId}` });
        const pdfDocument = await loading.promise;
        const page = await pdfDocument.getPage(Math.min(Math.max(1, floorItem.page), pdfDocument.numPages));
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const layer = document.createElement('canvas');
        layer.width = Math.max(1, Math.round(viewport.width));
        layer.height = Math.max(1, Math.round(viewport.height));
        const layerContext = layer.getContext('2d');
        if (layerContext) await page.render({ canvasContext: layerContext, viewport, canvas: layer }).promise;
        context.drawImage(layer, 0, 0, width, height);
        void loading.destroy();
      } catch (error) {
        logDiagnostic('error', error, 'capturePlan:pdf'); // план выгружается без подложки
      }
    }
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildPlanSvg(project, floorItem));
    await decodeImage(image);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => target.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return { title: floorItem.name, png: new Uint8Array(await blob.arrayBuffer()) };
  } catch (error) {
    logDiagnostic('error', error, 'capturePlan');
    return null;
  }
}

/** Листы «План» только для этажей, где есть оборудование или трассы. */
export async function collectPlans(project: Project): Promise<CapturedPlan[]> {
  const plans: CapturedPlan[] = [];
  for (const floorItem of project.floors) {
    const hasContent = project.equipment.some(item => item.floorId === floorItem.id)
      || project.routes.some(route => route.segments.some(segment => segment.a.floorId === floorItem.id || segment.b.floorId === floorItem.id));
    if (!hasContent) continue;
    const plan = await capturePlan(project, floorItem);
    if (plan) plans.push(plan);
  }
  return plans;
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
