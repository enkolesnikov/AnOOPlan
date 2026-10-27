import type { Project } from '../model';
import { APP_VERSION } from '../About';
import { clientCsv } from '../client-csv';
import { collectPinPhotos, collectPhotos, collectPlans } from '../plan-capture';
import { diagnosticsText } from '../diagnostics';
import { buildAttachmentManifest } from '../attachment-manifest';
import { idbGet } from '../idb';
import { exportSheets } from '../sheets';
import { ANOOPLAN_EXTENSION, ANOOPLAN_MIME, buildAnoPlanFile, serializeAnoPlanFile } from '../project-file';
import { JOURNAL_SECTIONS } from './constants';
import { storageHealth } from '../storage-health';
import { blobToBase64, bytesToBase64, nativeBridge, saveBlobOnDevice } from './native';
import type { ProjectIo } from './use-project-io';
import type { WorkspaceState } from './use-workspace-state';

/** Экспорт, печать, публикация и резервные копии проекта. */
export function useExport(s: WorkspaceState, io: ProjectIo) {
  const { projectRef, staticMode, printSections, setMessage } = s;
  const { saveProject } = io;
  async function printJournal() {
    const current = projectRef.current;
    const include = printSections;
    if (!include.length) {
      setMessage('Выберите хотя бы один раздел для печати.');
      return;
    }
    const bridge = nativeBridge();
    if (typeof bridge?.printPdf !== 'function') {
      setMessage('Печать доступна в мобильном приложении.');
      return;
    }
    const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('../export-pdf'), import('../export-fonts')]);
    const photos = include.includes('photos') ? await collectPhotos(current) : [];
    const pinPhotos = include.includes('pinPhotos') ? await collectPinPhotos(current) : [];
    const plans = include.includes('plans')
      ? await collectPlans(current, (done, total) => { if (total > 1) setMessage(`Планы: ${done} из ${total}…`); })
      : { plans: [], warnings: [] };
    const bytes = await buildJournalPdf(current, await loadJournalFonts(), { include, photos, pinPhotos, plans: plans.plans });
    bridge.printPdf(current.name, bytesToBase64(bytes));
    setMessage(`Открыт системный диалог печати: разделов ${include.length} из ${JOURNAL_SECTIONS.length}.${plans.warnings.length ? ` ${plans.warnings.join(' ')}` : ''}`);
  }

  /** Практический предел base64-архива: не даём собрать несколько копий и упасть по OOM. */
  const MAX_ARCHIVE_BASE64 = 40 * 1024 * 1024;
  /** PDF/фото текущего проекта для резервной копии и файла .anooplan. */
  async function collectProjectArchive(current: Project): Promise<{ pdfs: { id: string; name: string; dataBase64: string }[]; photos: { key: string; name: string; mime: string; dataBase64: string }[]; warnings: string[] }> {
    const warnings: string[] = [];
    let totalBase64 = 0;
    const account = (dataBase64: string): void => { totalBase64 += dataBase64.length; if (totalBase64 > MAX_ARCHIVE_BASE64) throw new Error('Архив слишком большой для одного файла. Удалите лишние фото/PDF или используйте несколько проектов.'); };
    const pdfs: { id: string; name: string; dataBase64: string }[] = [];
    const seenPdf = new Set<string>();
    for (const stageFloor of current.floors) {
      const pdfId = stageFloor.pdfId;
      if (!pdfId || seenPdf.has(pdfId)) continue;
      seenPdf.add(pdfId);
      if (pdfId.startsWith('idb:')) {
        const pdfBlob = await idbGet(pdfId.slice(4));
        if (pdfBlob) { const dataBase64 = await blobToBase64(pdfBlob); account(dataBase64); pdfs.push({ id: pdfId, name: 'plan.pdf', dataBase64 }); }
        else warnings.push(`PDF ${pdfId} не найден в хранилище`);
        continue;
      }
      // data:-подложка (демо/встроенный PDF) уже лежит в проекте — не дублируем её.
      if (pdfId.startsWith('data:')) continue;
      if (staticMode) { warnings.push(`PDF ${pdfId} недоступен в браузерном режиме`); continue; }
      // Серверный id: вкладываем исходный PDF, чтобы файл .anooplan оставался самодостаточным.
      try {
        const response = await fetch('/api/pdfs/' + encodeURIComponent(pdfId));
        if (!response.ok) { warnings.push(`PDF ${pdfId}: сервер вернул ${response.status}`); continue; }
        { const dataBase64 = await blobToBase64(await response.blob()); account(dataBase64); pdfs.push({ id: pdfId, name: 'plan.pdf', dataBase64 }); }
      } catch (error) { warnings.push(`PDF ${pdfId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const photoKeys = [...new Set([...current.equipment, ...current.pins].flatMap(item => item.photos || []))];
    const photos: { key: string; name: string; mime: string; dataBase64: string }[] = [];
    for (const key of photoKeys) {
      try {
        const photoBlob = await idbGet('photo:' + key);
        if (photoBlob) { const dataBase64 = await blobToBase64(photoBlob); account(dataBase64); photos.push({ key, name: 'photo.jpg', mime: photoBlob.type || 'image/jpeg', dataBase64 }); }
        else warnings.push(`Фото ${key} не найдено в хранилище`);
      } catch (error) { warnings.push(`Фото ${key}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return { pdfs, photos, warnings };
  }
  /** Единая сборка экспортного файла: используется и «Сохранить», и «Поделиться». */
  async function buildExportBlob(kind: 'csv' | 'xlsx' | 'pdf' | 'backup'): Promise<{ blob: Blob; fileName: string; warning: string }> {
    const current = projectRef.current;
    const health = await storageHealth();
    if (health && health.ratio >= 0.9) throw new Error(`Мало свободного места (занято ${Math.round(health.ratio * 100)}%). Освободите хранилище или выгрузите проект перед экспортом.`);
    // Один клиентский экспорт для браузера и серверного режима: серверного /export больше нет.
    if (!staticMode) await saveProject();
    if (kind === 'xlsx') {
      const { buildWorkbook } = await import('../export-xlsx');
      const blob = new Blob([buildWorkbook(exportSheets(current)) as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return { blob, fileName: `${current.name}.xlsx`, warning: '' };
    }
    if (kind === 'pdf') {
      const [{ buildJournalPdf }, { loadJournalFonts }] = await Promise.all([import('../export-pdf'), import('../export-fonts')]);
      const plans = await collectPlans(current, (done, total) => { if (total > 1) setMessage(`Планы: ${done} из ${total}…`); });
      const bytes = await buildJournalPdf(current, await loadJournalFonts(), { photos: await collectPhotos(current), pinPhotos: await collectPinPhotos(current), plans: plans.plans });
      return { blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), fileName: `${current.name}.pdf`, warning: plans.warnings.join(' ') };
    }
    if (kind === 'backup') {
      const { pdfs, photos, warnings } = await collectProjectArchive(current);
      if (warnings.length) throw new Error(`Резервная копия неполная: ${warnings.join('; ')}. Освободите место и повторите.`);
      const manifest = await buildAttachmentManifest(pdfs, photos);
      return { blob: new Blob([JSON.stringify({ schemaVersion: 2, project: current, pdfs, photos, manifest })], { type: 'application/json' }), fileName: `${current.name}.json`, warning: '' };
    }
    return { blob: new Blob([clientCsv(current)], { type: 'text/csv;charset=utf-8' }), fileName: `${current.name}.csv`, warning: '' };
  }
  async function download(kind: 'csv' | 'xlsx' | 'pdf' | 'backup') {
    const { blob, fileName, warning } = await buildExportBlob(kind);
    const done: Record<string, string> = {
      csv: 'Экспорт CSV сохранён',
      xlsx: 'Таблицы Excel сохранены',
      pdf: 'Журнал PDF сохранён',
      backup: 'Резервная копия сохранена',
    };
    const warningText = warning ? ` ${warning}` : '';
    const savedPath = await saveBlobOnDevice(fileName, blob);
    if (savedPath) {
      setMessage(`${done[kind]}: ${savedPath}${warningText}`);
      return;
    }
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setMessage(`${done[kind].replace('сохранён', 'готов').replace('сохранены', 'готовы')}.${warningText}`);
  }
  async function shareBlob(name: string, blob: Blob, mime: string): Promise<void> {
    const bridge = nativeBridge();
    if (typeof bridge?.shareFile !== 'function') {
      setMessage('Поделиться файлом можно только в мобильном приложении.');
      return;
    }
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const result = bridge.shareFile(name, base64, mime || blob.type || 'application/octet-stream');
    if (!result.startsWith('ok:')) throw new Error(result.replace(/^err:\s*/, '') || 'Не удалось поделиться файлом');
    setMessage(`Файл «${name}» передан в системное меню «Поделиться».`);
  }
  async function shareExport(kind: 'pdf' | 'xlsx'): Promise<void> {
    const { blob, fileName } = await buildExportBlob(kind);
    await shareBlob(fileName, blob, blob.type);
  }
  async function buildAnoPlanBlob(): Promise<{ blob: Blob; fileName: string }> {
    const current = projectRef.current;
    const { pdfs, photos, warnings } = await collectProjectArchive(current);
    if (warnings.length) throw new Error(`Файл .anooplan неполный: ${warnings.join('; ')}. Освободите место и повторите.`);
    const manifest = await buildAttachmentManifest(pdfs, photos);
    const json = serializeAnoPlanFile(buildAnoPlanFile(current, pdfs, photos, manifest));
    return { blob: new Blob([json], { type: ANOOPLAN_MIME }), fileName: `${current.name}${ANOOPLAN_EXTENSION}` };
  }
  async function saveAnoPlan(): Promise<void> {
    const { blob, fileName } = await buildAnoPlanBlob();
    const savedPath = await saveBlobOnDevice(fileName, blob);
    if (savedPath) {
      setMessage(`Проект сохранён в файл: ${savedPath}`);
      return;
    }
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setMessage(`Файл ${fileName} сформирован.`);
  }
  async function shareAnoPlan(): Promise<void> {
    const { blob, fileName } = await buildAnoPlanBlob();
    await shareBlob(fileName, blob, ANOOPLAN_MIME);
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
  return { printJournal, download, shareExport, saveAnoPlan, shareAnoPlan, exportDiagnostics };
}
