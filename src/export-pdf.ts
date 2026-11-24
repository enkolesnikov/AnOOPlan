// Офлайн-сборка PDF кабельного журнала: pdf-lib + встроенный PT Sans (кириллица).
// Документ A4/A3 landscape, повторяющиеся заголовки таблиц, полный штамп ГОСТ 2.104
// (форма 2) и отметка неполного расчёта.
//
// Фасад над тремя модулями: pdf/pdf-model.ts (типы и текстовые утилиты),
// pdf/pdf-sections.ts (данные разделов), pdf/pdf-renderer.ts (отрисовка листов).
// Публичный API прежний — импорты снаружи менять не нужно.
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from './model';
import { domainWarnings, specifications, validateProject } from './engine';
import { estimate } from './estimate';
import type { JournalFonts } from './export-fonts';
import { Renderer } from './pdf/pdf-renderer';
import { buildSections } from './pdf/pdf-sections';
import {
  DEFAULT_JOURNAL_SECTIONS,
  MUTED,
  normalizeFormat,
  normalizeScale,
  type JournalOptions,
  type JournalSectionId,
  type TocEntry,
} from './pdf/pdf-model';

export {
  formatDateRu,
  formatMoney,
  formatNumber,
  type JournalFormat,
  type JournalOptions,
  type JournalPhoto,
  type JournalSectionId,
} from './pdf/pdf-model';

/** Доступные форматы листа: данные живут рядом с JOURNAL_SECTIONS, API — здесь. */
export { JOURNAL_FORMATS } from './ui/constants';

export async function buildJournalPdf(project: Project, fonts: JournalFonts, options: JournalOptions = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const regular = await document.embedFont(new Uint8Array(fonts.regular), { subset: true });
  const bold = await document.embedFont(new Uint8Array(fonts.bold), { subset: true });
  document.setTitle(`AnOOPlan — ${project.name}`);
  document.setAuthor('AnOOPlan');
  document.setCreator('AnOOPlan');
  document.setProducer('AnOOPlan');

  const renderer = new Renderer(document, regular, bold, normalizeFormat(options.format), normalizeScale(options.scale));
  // Титульный лист (страница 1) и оглавление выводятся всегда. Оглавление может
  // занять несколько листов: резервируем их заранее, пока номера разделов ещё не посчитаны.
  renderer.titlePage(project);
  const estimateResult = estimate(project);
  const include = new Set<JournalSectionId>(options.include ?? DEFAULT_JOURNAL_SECTIONS);
  const sections = buildSections(project, estimateResult);
  // Предупреждения считаются до резервирования листов оглавления: иначе на каждый
  // документ добавлялся пустой зарезервированный лист «Оглавление (продолжение)».
  const warnings = include.has('warnings')
    ? [...new Set([...validateProject(project), ...domainWarnings(project), ...specifications(project).errors, ...estimateResult.warnings])]
    : [];
  const expectedEntries = sections.filter(section => include.has(section.id)).length
    + (include.has('plans') ? (options.plans?.length ?? 0) : 0)
    + (include.has('photos') && options.photos?.length ? 1 : 0)
    + (include.has('pinPhotos') && options.pinPhotos?.length ? 1 : 0)
    + (include.has('signaturesSheet') ? 1 : 0)
    + (warnings.length ? 1 : 0);
  // Ёмкость листа оглавления считается по фактической нижней границе контента:
  // со штампом ГОСТ она выше, чем раньше, поэтому шаг 23 pt даёт меньше строк.
  const tocTop = renderer.height - renderer.margin - 64;
  const tocCapacity = Math.max(1, Math.floor((tocTop - (renderer.contentBottom + 20)) / 23) + 1);
  const tocPageCount = Math.max(1, Math.ceil(expectedEntries / tocCapacity));
  const tocPages = Array.from({ length: tocPageCount }, () => renderer.addPage());
  renderer.addPage();
  const toc: TocEntry[] = [];
  for (const section of sections) {
    if (!include.has(section.id)) continue;
    // Заголовок раздела не должен оставаться один внизу страницы: оставляем место
    // хотя бы под шапку таблицы и пару строк.
    if (section.rows.length) renderer.ensure(120);
    const page = renderer.heading(section.title, section.note);
    toc.push({ title: section.title, page });
    if (section.rows.length) renderer.table(section.columns, section.rows, section.title);
    else renderer.paragraph(section.emptyText ?? 'Нет записей.', MUTED);
    if (section.footer) renderer.paragraph(section.footer, MUTED);
  }

  const plansLast = !warnings.length
    && !(include.has('photos') && options.photos?.length)
    && !(include.has('pinPhotos') && options.pinPhotos?.length);
  if (include.has('plans') && options.plans?.length) {
    toc.push(...await renderer.plans(options.plans, plansLast ? 104 : 0));
  }
  if (include.has('photos') && options.photos?.length) {
    const page = await renderer.photos(options.photos);
    if (page !== null) toc.push({ title: 'Фотографии оборудования', page });
  }
  if (include.has('pinPhotos') && options.pinPhotos?.length) {
    const page = await renderer.photos(options.pinPhotos, 'Фотографии замечаний');
    if (page !== null) toc.push({ title: 'Фотографии замечаний', page });
  }

  if (include.has('warnings')) {
    if (warnings.length) {
      const page = renderer.heading('Замечания и предупреждения', 'Проверьте данные перед применением документации на объекте.');
      toc.push({ title: 'Замечания и предупреждения', page });
      renderer.list(warnings);
    }
  }

  renderer.totals(project);
  const signaturesPage = renderer.signatures(project, include.has('signaturesSheet'));
  if (signaturesPage !== null) toc.push({ title: 'Лист подписей', page: signaturesPage });
  renderer.drawContents(tocPages, toc);
  renderer.finish(project);
  return document.save();
}
