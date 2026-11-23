// Данные разделов печатной формы: журнал, спецификации, смета, КП, замечания,
// лист изменений. Отрисовка — в pdf-renderer.ts; здесь только строки таблиц.
import type { Project } from '../model';
import { cableSection, calculateCable, routeSectionsText, specificationKnS, specifications } from '../engine';
import { estimate, normalizeRounding, roundMoney } from '../estimate';
import { netLabel } from '../sheets';
import { cableDiameter, formatDateRu, formatMoney, formatNumber, type Section, type TableRow } from './pdf-model';

export type EstimateResult = ReturnType<typeof estimate>;

/** Подпись строки работ: «Работы (25 %)»; без заданного процента — «Работы (не задан)», а не 0. */
const laborLabel = (percent: number | null): string => (percent === null ? 'Работы (не задан)' : `Работы (${formatNumber(percent)} %)`);

/** Подпись работ: процент от материалов либо режим работ по видам. */
const laborSummaryLabel = (result: EstimateResult): string =>
  result.worksMode === 'items' ? 'Работы (по видам)' : laborLabel(result.laborPercent);

/** Начисляется ли НДС: нулевая или отсутствующая ставка — не начисляется. */
const vatCharged = (result: EstimateResult): boolean => result.vatRate !== null && result.vatRate > 0;

/** Строка НДС: «НДС 20 %» или «НДС 20 % (в т.ч.)», если цены уже включают налог. */
const vatLabel = (result: EstimateResult): string =>
  `НДС ${formatNumber(result.vatRate)} %${result.vatIncluded ? ' (в т.ч.)' : ''}`;

export function buildSections(project: Project, estimateResult: EstimateResult): Section[] {
  const specs = specifications(project);
  const specKnS = specificationKnS(project);
  const equipmentNumber = (id: string) => project.equipment.find(item => item.id === id)?.number || '—';

  // Итог журнала — последней строкой таблицы, а не только плашкой на листе плана:
  // документ читают по разделу, и «Итого» должно стоять под данными.
  let journalMeters = 0;
  let journalCost = 0;
  let journalComplete = true;
  const journalRounding = normalizeRounding(project.estimate?.rounding) ?? 0.01;
  const journal: TableRow[] = project.cables.map(cable => {
    const result = calculateCable(project, cable);
    const section = cableSection(cable);
    // Примечание кабеля печатается второй строкой в ячейке «Кабель / марка»:
    // отдельной колонки в журнале нет, а терять текст нельзя (в XLSX/CSV он есть).
    const note = (cable.note ?? '').trim();
    return [
      cable.number,
      (([cable.name, cable.brand].filter(Boolean).join(' · ') || '—') + (note ? `\n${note}` : '')),
      formatNumber(cableDiameter(cable)),
      formatNumber(section.areaMm2),
      `${equipmentNumber(cable.fromId)} - ${equipmentNumber(cable.toId)}`,
      formatNumber(result.geometry),
      formatNumber(result.routeReserve),
      formatNumber(result.cableReserve),
      formatNumber(result.endReserve),
      formatNumber(result.total),
      Number.isFinite(cable.quantity) ? String(cable.quantity) : '—',
      formatNumber(result.total === null || !Number.isFinite(cable.quantity) ? null : result.total * cable.quantity),
      formatMoney(result.pricePerMeter),
      formatMoney(result.cost),
      result.complete ? 'полный' : 'неполный',
    ];
  });
  for (const cable of project.cables) {
    const result = calculateCable(project, cable);
    if (result.total === null || !Number.isFinite(cable.quantity)) journalComplete = false;
    else journalMeters += result.total * cable.quantity;
    if (result.cost === null) journalComplete = false;
    else journalCost += roundMoney(result.cost, journalRounding);
  }
  if (journal.length) {
    journal.push({
      cells: [
        'Итого',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        journalComplete ? formatNumber(journalMeters) : '—',
        '',
        journalComplete ? formatMoney(journalCost) : '—',
        journalComplete ? '' : 'неполный',
      ],
      bold: true,
      zebra: true,
    });
  }

  // Смета: строки работ по видам — только в режиме 'items'; итоги — с НДС и округлением.
  const estimateRows: TableRow[] = [];
  for (const section of estimateResult.sections.filter(item => item.kind !== 'work')) {
    for (const line of section.lines) {
      estimateRows.push([
        section.title,
        line.name || '—',
        line.unit || '—',
        formatNumber(line.quantity),
        formatMoney(line.price),
        formatMoney(line.total),
      ]);
    }
    estimateRows.push(['', `Итого: ${section.title}`, '', '', '', formatMoney(section.total)]);
  }
  if (estimateResult.worksMode === 'items') {
    const worksSection = estimateResult.sections.find(item => item.kind === 'work');
    for (const line of worksSection?.lines ?? []) {
      estimateRows.push([
        worksSection?.title ?? 'Работы',
        line.name || '—',
        line.unit || '—',
        formatNumber(line.quantity),
        formatMoney(line.price),
        formatMoney(line.total),
      ]);
    }
  }
  estimateRows.push(['', 'Итого материалы', '', '', '', formatMoney(estimateResult.materials)]);
  estimateRows.push(['', laborSummaryLabel(estimateResult), '', '', '', formatMoney(estimateResult.labor)]);
  estimateRows.push(['', vatCharged(estimateResult) ? netLabel(estimateResult) : 'Итого по смете', '', '', '', formatMoney(estimateResult.net)]);
  if (vatCharged(estimateResult)) {
    estimateRows.push(['', vatLabel(estimateResult), '', '', '', formatMoney(estimateResult.vat)]);
    estimateRows.push(['', 'Итого с НДС', '', '', '', formatMoney(estimateResult.gross)]);
  }

  // Коммерческое предложение: те же итоги с НДС, примечание о ценах с налогом/без.
  const commercialRows: TableRow[] = [
    ...estimateResult.sections.filter(section => section.kind !== 'work').map(section => [section.title, formatMoney(section.total)]),
    ['Итого материалы', formatMoney(estimateResult.materials)],
    [laborSummaryLabel(estimateResult), formatMoney(estimateResult.labor)],
    [vatCharged(estimateResult) ? netLabel(estimateResult) : 'Итого', formatMoney(estimateResult.net)],
  ];
  if (vatCharged(estimateResult)) {
    commercialRows.push([vatLabel(estimateResult), formatMoney(estimateResult.vat)]);
    commercialRows.push(['Итого с НДС', formatMoney(estimateResult.gross)]);
  }

  // Спецификация КНС: строки идут блоками по подсистемам, после блока — подытог.
  const knsRows: TableRow[] = [];
  let knsOffset = 0;
  for (const group of specKnS.subsystems) {
    const groupLines = specKnS.lines.slice(knsOffset, knsOffset + group.lines);
    knsOffset += group.lines;
    for (const line of groupLines) {
      knsRows.push([
        line.name,
        line.section || '—',
        line.subsystem,
        line.unit,
        formatNumber(line.quantity),
        line.angles ? String(line.angles) : '—',
        [line.article, line.manufacturer].filter(Boolean).join(' / ') || '—',
        formatMoney(line.cost),
      ]);
    }
    knsRows.push({
      cells: [
        'Итого по подсистеме',
        '',
        group.subsystem,
        'м',
        formatNumber(group.length),
        group.angles ? String(group.angles) : '—',
        '',
        formatMoney(group.cost),
      ],
      bold: true,
      zebra: true,
    });
  }
  // Страховка на случай несовпадения группировки: ни одна строка не должна потеряться.
  for (const line of specKnS.lines.slice(knsOffset)) {
    knsRows.push([
      line.name,
      line.section || '—',
      line.subsystem,
      line.unit,
      formatNumber(line.quantity),
      line.angles ? String(line.angles) : '—',
      [line.article, line.manufacturer].filter(Boolean).join(' / ') || '—',
      formatMoney(line.cost),
    ]);
  }

  const estimateNote = [
    `Дата прайса: ${formatDateRu(estimateResult.catalogDate)}`,
    estimateResult.rounding !== null ? `Округление: до ${formatNumber(estimateResult.rounding)} ₽` : '',
    'Неизвестные значения показаны как «—» и не заменяются нулём.',
  ].filter(Boolean).join(' · ');

  return [
    {
      id: 'journal',
      title: 'Кабельный журнал',
      note: 'Длина одного кабеля учитывает геометрию трассы, запасы трасс и кабеля, концевые запасы. «S каб.» — площадь по наружному диаметру для расчёта заполнения КНС, а не сечение жилы. Неполные данные помечены и не заменяются нулём.',
      columns: [
        { title: '№', width: 28 },
        { title: 'Кабель / марка', width: 136 },
        { title: 'Ø, мм', width: 32, align: 'right' },
        { title: 'S каб., мм²', width: 44, align: 'right' },
        { title: 'От - до', width: 66 },
        { title: 'Геометрия, м', width: 50, align: 'right' },
        { title: 'Запас трасс', width: 52, align: 'right' },
        { title: 'Запас кабеля', width: 54, align: 'right' },
        { title: 'Концы', width: 36, align: 'right' },
        { title: 'Итог / шт, м', width: 52, align: 'right' },
        { title: 'Кол.', width: 26, align: 'right' },
        { title: 'Итого, м', width: 50, align: 'right' },
        { title: 'Цена, ₽/м', width: 48, align: 'right' },
        { title: 'Стоимость, ₽', width: 54, align: 'right' },
        { title: 'Статус', width: 46 },
      ],
      rows: journal,
    },
    {
      id: 'equipment',
      title: 'Оборудование',
      columns: [
        { title: 'Тип', width: 200 },
        { title: 'Модель', width: 200 },
        { title: 'Этаж', width: 200 },
        { title: 'Количество', width: 100, align: 'right' },
      ],
      rows: specs.equipment.map(row => [row.type, row.model, row.floor, String(row.quantity)]),
    },
    {
      id: 'cables',
      title: 'Кабельная продукция',
      columns: [
        { title: 'Марка', width: 240 },
        { title: 'Количество линий', width: 150, align: 'right' },
        { title: 'Геометрия, м', width: 160, align: 'right' },
        { title: 'Итого, м', width: 160, align: 'right' },
      ],
      rows: specs.cables.map(row => [row.brand, String(row.lines), formatNumber(row.geometry), formatNumber(row.total)]),
    },
    {
      id: 'routeScheme',
      title: 'Схема трасс',
      note: 'Метраж трасс по типам КНС (включая гофру), сечения участков и количество углов кабельных каналов/коробов. Сечение берётся с сегмента, если оно там задано, иначе с трассы. Фитинги и крепления не считаются.',
      columns: [
        { title: 'Трасса', width: 46 },
        { title: 'Тип КНС', width: 120 },
        { title: 'Сечения', width: 170 },
        { title: 'Длина, м', width: 70, align: 'right' },
        { title: 'Сегментов', width: 64, align: 'right' },
        { title: 'Углы', width: 46, align: 'right' },
      ],
      rows: specs.routeSummary.routes.map(row => [
        row.number,
        row.type || '—',
        routeSectionsText(row.sections, formatNumber),
        formatNumber(row.length),
        String(row.segments),
        row.group === 'Кабель-канал' ? String(row.angles.total) : '—',
      ]),
      emptyText: 'Трасс нет.',
      footer: specs.routeSummary.groups.length
        ? `Итого по типам: ${specs.routeSummary.groups.map(group => `${group.group} — ${formatNumber(group.length)} м${group.group === 'Кабель-канал' ? `, углов ${group.angles.total}` : ''}`).join('; ')}.`
        : undefined,
    },
    {
      id: 'knSSpec',
      title: 'Спецификация КНС',
      note: 'Материалы КНС по подсистемам и сечениям: если у сегмента своё сечение, его метраж входит отдельной строкой. Углы указаны для кабельных каналов/коробов; фитинги и крепления не считаются. Цены и артикулы — из справочника цен проекта.',
      columns: [
        { title: 'Наименование', width: 100 },
        { title: 'Сечение', width: 70 },
        { title: 'Подсистема', width: 90 },
        { title: 'Ед.', width: 28 },
        { title: 'Кол-во', width: 50, align: 'right' },
        { title: 'Углы', width: 36, align: 'right' },
        { title: 'Артикул / производитель', width: 160 },
        { title: 'Сумма, ₽', width: 70, align: 'right' },
      ],
      rows: knsRows,
      emptyText: 'Трасс для спецификации нет.',
      footer: [
        specKnS.totals.length
          ? `Итого по типам: ${specKnS.totals.map(item => `${item.group} — ${formatNumber(item.length)} м${item.angles ? `, углов ${item.angles}` : ''}, ${formatNumber(item.cost)} ₽`).join('; ')}.`
          : '',
        `Всего КНС: ${formatNumber(specKnS.totalLength)} м, ${formatNumber(specKnS.totalCost)} ₽.`,
        ...specKnS.warnings,
      ].filter(Boolean).join(' '),
    },
    {
      id: 'infrastructure',
      title: 'Кабельная инфраструктура',
      columns: [
        { title: 'Тип', width: 180 },
        { title: 'Длина, м', width: 120, align: 'right' },
        { title: 'Сегментов', width: 110, align: 'right' },
        { title: 'Кабелей', width: 100, align: 'right' },
        { title: 'Макс. заполнение, %', width: 130, align: 'right' },
        { title: 'Сегментов с превышением', width: 150, align: 'right' },
      ],
      rows: specs.infrastructure.map(row => [row.type, formatNumber(row.length), String(row.segments), String(row.cables), formatNumber(row.maxFillPercent), String(row.overSegments)]),
    },
    {
      id: 'trayFill',
      title: 'Заполнение КНС',
      note: 'Заполнение — отношение площади сечения кабелей к площади КНС (лоток, короб, труба, гофра). Внимание выше 40 %, превышение выше 50 %. «Неполный» означает, что сечение не задано и не заменено нулём. Сечение в строке — эффективное для сегмента: своё переопределение важнее размера трассы.',
      columns: [
        { title: 'Трасса', width: 44 },
        { title: 'Сегмент', width: 56 },
        { title: 'КНС, мм', width: 72 },
        { title: 'Площадь КНС, мм²', width: 84, align: 'right' },
        { title: 'Линий', width: 40, align: 'right' },
        { title: 'Площадь кабелей, мм²', width: 90, align: 'right' },
        { title: 'Заполнение, %', width: 80, align: 'right' },
        { title: 'Статус', width: 80 },
      ],
      rows: specs.trayFill.map(row => [
        row.route,
        row.segment,
        row.tray || '—',
        formatNumber(row.trayAreaMm2),
        String(row.lines),
        formatNumber(row.areaMm2),
        formatNumber(row.fillPercent),
        row.status,
      ]),
    },
    {
      id: 'estimate',
      title: 'Смета',
      note: estimateNote,
      columns: [
        { title: 'Раздел', width: 110 },
        { title: 'Позиция', width: 190 },
        { title: 'Ед.', width: 40 },
        { title: 'Количество', width: 60, align: 'right' },
        { title: 'Цена, ₽', width: 70, align: 'right' },
        { title: 'Сумма, ₽', width: 80, align: 'right' },
      ],
      rows: estimateRows,
    },
    {
      id: 'commercial',
      title: 'Коммерческое предложение',
      note: [
        `Дата прайса: ${formatDateRu(estimateResult.catalogDate)}`,
        project.estimate?.note ? `Примечание: ${project.estimate.note}` : '',
        estimateResult.vatIncluded ? 'Цены с НДС.' : 'Цены без НДС.',
        'Неизвестные значения не заменяются нулём.',
      ].filter(Boolean).join(' · '),
      columns: [
        { title: 'Раздел', width: 220 },
        { title: 'Сумма, ₽', width: 120, align: 'right' },
      ],
      rows: commercialRows,
    },
    {
      id: 'pins',
      title: 'Замечания',
      note: 'Пины-замечания по этажам. Статус «закрыто» означает, что замечание отработано.',
      columns: [
        { title: '№', width: 44 },
        { title: 'Этаж', width: 150 },
        { title: 'X', width: 70, align: 'right' },
        { title: 'Y', width: 70, align: 'right' },
        { title: 'Замечание', width: 286 },
        { title: 'Статус', width: 90 },
      ],
      rows: (project.pins ?? []).map(pin => [
        pin.number,
        project.floors.find(floor => floor.id === pin.floorId)?.name || '—',
        formatNumber(pin.x),
        formatNumber(pin.y),
        pin.comment || '—',
        pin.status === 'closed' ? 'закрыто' : 'открыто',
      ]),
    },
    {
      id: 'changeLog',
      title: 'Лист регистрации изменений',
      note: 'Записи о редакциях документа: изм., содержание, дата и автор.',
      emptyText: 'Изменений нет.',
      columns: [
        { title: 'Изм.', width: 50 },
        { title: 'Лист/раздел', width: 90 },
        { title: 'Содержание', width: 330 },
        { title: 'Дата', width: 110 },
        { title: 'ФИО', width: 120 },
      ],
      rows: (project.document?.changeLog ?? []).map(entry => [
        entry.version || '—',
        '—',
        entry.description || '—',
        formatDateRu(entry.date),
        entry.author || '—',
      ]),
    },
  ];
}
