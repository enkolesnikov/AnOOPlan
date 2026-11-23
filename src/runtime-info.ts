import type { Project } from './model';
import { formatBytes, storageHealth, type StorageHealth } from './storage-health';

/**
 * Сведения о среде выполнения для экрана «О программе» и диагностического
 * отчёта (3.0.0): версия WebView, занятое место и закрепление хранилища,
 * размер текущего проекта. Всё собирается локально, без сети.
 */

/** Краткое имя движка из User-Agent: «WebView 137», «Chrome 137», «Safari 17»… */
export function webViewVersion(userAgent: string): string {
  if (!userAgent) return 'неизвестно';
  const chrome = /Chrome\/(\d+)(?:\.\d+)*/.exec(userAgent);
  const isWebView = /;\s*wv\)/.test(userAgent) || /Version\/\d[\d.]*\s+Chrome\//.test(userAgent);
  if (chrome) return `${isWebView ? 'WebView' : 'Chrome'} ${chrome[1]}`;
  const safari = /Version\/(\d+)(?:\.\d+)*/.exec(userAgent);
  if (safari && /Safari\//.test(userAgent) && !chrome) return `Safari ${safari[1]}`;
  const firefox = /Firefox\/(\d+)/.exec(userAgent);
  if (firefox) return `Firefox ${firefox[1]}`;
  return 'неизвестно';
}

export interface ProjectSizeInfo {
  bytes: number;
  floors: number;
  equipment: number;
  routes: number;
  cables: number;
  pins: number;
}

/** Размер проекта в JSON-представлении и счётчики объектов. */
export function projectSizeInfo(project: Project): ProjectSizeInfo {
  let bytes = 0;
  try {
    bytes = new Blob([JSON.stringify(project)]).size;
  } catch { /* сериализация недоступна — размер не считаем */ }
  return {
    bytes,
    floors: project.floors.length,
    equipment: project.equipment.length,
    routes: project.routes.length,
    cables: project.cables.length,
    pins: project.pins.length,
  };
}

export interface RuntimeReport {
  appVersion: string;
  generatedAt: string;
  userAgent: string;
  webView: string;
  language: string;
  storage: StorageHealth | null;
  persisted: boolean | null;
  project: ProjectSizeInfo;
}

/** Полный снимок среды: UA, квота хранилища, закрепление и размер проекта. */
export async function collectRuntimeReport(appVersion: string, project: Project): Promise<RuntimeReport> {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  let persisted: boolean | null = null;
  try {
    persisted = typeof navigator !== 'undefined' && navigator.storage?.persisted
      ? await navigator.storage.persisted()
      : null;
  } catch { /* API недоступно */ }
  return {
    appVersion,
    generatedAt: new Date().toISOString(),
    userAgent,
    webView: webViewVersion(userAgent),
    language: typeof navigator === 'undefined' ? '' : navigator.language,
    storage: await storageHealth(),
    persisted,
    project: projectSizeInfo(project),
  };
}

/** Строки отчёта для текстового экспорта и экрана «О программе». */
export function runtimeReportLines(report: RuntimeReport): string[] {
  const lines = [
    `WebView / движок: ${report.webView}`,
    `User-Agent: ${report.userAgent || '—'}`,
    `Язык: ${report.language || '—'}`,
  ];
  if (report.storage) {
    const percent = report.storage.quota > 0 ? Math.round(report.storage.ratio * 100) : 0;
    lines.push(`Хранилище: занято ${formatBytes(report.storage.usage)} из ${formatBytes(report.storage.quota)} (${percent}%)`);
  } else {
    lines.push('Хранилище: оценка занятого места недоступна');
  }
  if (report.persisted !== null) lines.push(`Закрепление хранилища (persist): ${report.persisted ? 'включено' : 'не запрошено/отклонено'}`);
  const p = report.project;
  lines.push(`Проект: ${formatBytes(p.bytes)} JSON — этажей ${p.floors}, оборуд. ${p.equipment}, трасс ${p.routes}, кабелей ${p.cables}, замечаний ${p.pins}`);
  return lines;
}
