import { useMemo, useRef, useState } from 'react';
import type { PriceItem, PriceKind, Project, ProjectEstimate, WorkLine } from '../model';
import { estimate, isCatalogDate, normalizeCatalog, normalizeRounding, roundMoney } from '../estimate';
import { parseCatalogRows, mergeCatalog, type CatalogImportResult } from '../catalog-import';
import { readCatalogFile } from '../catalog-file';
import type { EstimateResult, EstimateSection as EstimateSectionData } from '../estimate';
import { createUuid as uid } from '../compat';
import { number } from './format';
import { saveBlobOnDevice } from './native';
import { NumberField } from './number-field';


const PRICE_KIND_LABELS: Record<PriceKind, string> = { equipment: 'Оборудование', cable: 'Кабель', tray: 'КНС' };
const PRICE_SOURCE_LABELS: Record<'manual' | 'catalog', string> = { manual: 'вручную', catalog: 'справочник' };
/** Деньги и количества: null — «—», а не 0. */
const moneyText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? `${number(value)} ₽` : '—');
const quantityText = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? number(value) : '—');
/** Неотрицательное конечное число из строки, иначе null (пусто/мусор/минус не сохраняются). */
export const nonNegativeOrNull = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Сумма строки работ (количество × цена) с округлением сметы; null — значение неизвестно. */
export function workLineTotal(work: Pick<WorkLine, 'quantity' | 'price'>, rounding: number | null): number | null {
  if (work.quantity === null || work.price === null) return null;
  if (!Number.isFinite(work.quantity) || !Number.isFinite(work.price)) return null;
  return roundMoney(work.quantity * work.price, rounding);
}

/** Склонение «строка» по числу: 1 строка, 2 строки, 5 строк. */
export function workLinesWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'строка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'строки';
  return 'строк';
}

/** Статус сметы, режим работ, НДС и дата прайса в шапке экрана. */
function EstimateStatus({ result, catalogDateText }: { result: EstimateResult; catalogDateText: string }) {
  const modeText = result.worksMode === 'items'
    ? `работы по видам: ${result.works.length} ${workLinesWord(result.works.length)}`
    : result.laborPercent === null
      ? 'работы: процент не задан'
      : `работы: ${number(result.laborPercent)} % от материалов`;
  const vatRate = result.vatRate;
  const vatText = vatRate === null || vatRate === 0
    ? 'без НДС'
    : `НДС ${number(vatRate)} % ${result.vatIncluded ? 'в т.ч.' : 'сверху'}`;
  return <div className="estimate-status">
    <span className={`badge ${result.complete ? 'good' : 'warn'}`}>{result.complete ? 'Смета рассчитана' : 'Смета неполная'}</span>
    <small>Дата прайса: <strong>{catalogDateText}</strong></small>
    <small className="estimate-mode-note">{modeText} · {vatText}</small>
  </div>;
}

/** Режим работ, процент, НДС, округление и примечание к смете. */
function EstimateControls({ project, onChange }: { project: Project; onChange: (recipe: (project: Project) => void) => void }) {
  const setEstimate = (patch: Partial<ProjectEstimate>): void => {
    onChange(p => { p.estimate = { ...(p.estimate ?? { laborPercent: null }), ...patch }; });
  };
  const works = project.estimate?.works ?? [];
  const itemsMode = works.length > 0;
  const vatRate = project.estimate?.vatRate ?? null;
  const vatApplies = vatRate !== null && vatRate > 0;
  const rounding = normalizeRounding(project.estimate?.rounding);
  // «По видам» без строк создаёт одну пустую: режим включается сразу и явно.
  const enableItems = (): void => {
    if (itemsMode) return;
    setEstimate({ works: [{ id: uid(), name: '', unit: 'шт', quantity: null, price: null }] });
  };
  return <div className="estimate-controls">
    <fieldset className="estimate-mode">
      <legend>Режим работ</legend>
      <label className="estimate-mode-option">
        <input type="radio" name="works-mode" value="percent" aria-label="Режим работ: процент от материалов" checked={!itemsMode} disabled={itemsMode} onChange={() => { /* работы не удаляются молча: вернуться к проценту можно, удалив строки */ }} />
        Процент от материалов
      </label>
      <label className="estimate-mode-option">
        <input type="radio" name="works-mode" value="items" aria-label="Режим работ: по видам работ" checked={itemsMode} onChange={enableItems} />
        По видам работ
      </label>
      <small className="help">{itemsMode ? `Работы по видам: ${works.length} ${workLinesWord(works.length)} — чтобы вернуться к проценту, удалите строки в редакторе ниже.` : 'Процент применяется к стоимости материалов.'}</small>
    </fieldset>
    <label className="field estimate-labor" title={itemsMode ? 'В режиме по видам процент работ не применяется' : undefined}>Работы, %<NumberField value={project.estimate?.laborPercent ?? null} ariaLabel="Работы, %" placeholder="Не задано" onCommit={raw => setEstimate({ laborPercent: raw === '' ? null : nonNegativeOrNull(raw) })} /></label>
    <label className="field estimate-vat">НДС, %<NumberField value={vatRate} ariaLabel="НДС, %" placeholder="Не начисляется" onCommit={raw => setEstimate({ vatRate: raw === '' ? null : nonNegativeOrNull(raw) })} /></label>
    <label className={`estimate-vat-included${vatApplies ? '' : ' is-disabled'}`}>
      <input type="checkbox" aria-label="Цены включают НДС" checked={project.estimate?.vatIncluded === true} disabled={!vatApplies} onChange={event => setEstimate({ vatIncluded: event.target.checked })} />
      Цены включают НДС
    </label>
    <label className="field estimate-rounding">Округление
      <select aria-label="Округление" value={rounding === null ? '' : String(rounding)} onChange={event => setEstimate({ rounding: normalizeRounding(event.target.value === '' ? null : Number(event.target.value)) })}>
        <option value="">Без округления</option>
        <option value="0.01">До копейки</option>
        <option value="1">До рубля</option>
        <option value="10">До 10 ₽</option>
        <option value="100">До 100 ₽</option>
      </select>
    </label>
    <label className="field estimate-note-field">Примечание к смете<input type="text" value={project.estimate?.note ?? ''} placeholder="Например: Цены действительны 30 дней" onChange={event => setEstimate({ note: event.target.value })} /></label>
  </div>;
}

/** Почему смета неполная. */
function EstimateWarnings({ warnings }: { warnings: string[] }) {
  return <div className="estimate-warnings"><strong>Смета неполная</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>;
}

/** Таблица материалов раздела и итог по нему. */
function SectionTable({ section }: { section: EstimateSectionData }) {
  return <>
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
  </>;
}

/** Раздел «Работы»: процент от материалов и итог. */
function WorkSection({ section, laborPercent }: { section: EstimateSectionData; laborPercent: number | null }) {
  return <div className="estimate-work-summary">
    <p>Работы {laborPercent === null ? 'не рассчитаны: не задан процент.' : `— ${number(laborPercent)} % от стоимости материалов.`}</p>
    <div className="estimate-section-total"><span>Итого по разделу</span><strong>{section.total === null ? 'не рассчитано' : moneyText(section.total)}</strong></div>
    {laborPercent !== null && section.total === null && <p className="help">Стоимость работ не рассчитана: сначала должна быть известна стоимость материалов.</p>}
  </div>;
}

/** Один раздел сметы: заголовок и строки материалов либо блок работ. */
function EstimateSection({ section, result }: { section: EstimateSectionData; result: EstimateResult }) {
  return <section className="estimate-section">
    <div className="estimate-section-head">
      <h2>{section.title}</h2>
      <span className={`badge ${section.complete ? 'good' : 'warn'}`}>{section.complete ? 'раздел рассчитан' : 'неполный раздел'}</span>
    </div>
    {section.kind !== 'work'
      ? <SectionTable section={section} />
      : result.worksMode === 'items'
        ? <SectionTable section={section} />
        : <WorkSection section={section} laborPercent={result.laborPercent} />}
  </section>;
}

/** Итоги сметы: материалы, работы, итог до НДС, НДС и итог с НДС. */
function EstimateTotals({ result }: { result: EstimateResult }) {
  const vatRate = result.vatRate;
  const worksLabel = result.worksMode === 'items' ? ' (по видам)' : result.laborPercent === null ? '' : ` (${number(result.laborPercent)} %)`;
  return <div className="estimate-totals">
    <div><span>Материалы</span><strong>{result.materials === null ? 'не рассчитано' : moneyText(result.materials)}</strong></div>
    <div><span>Работы{worksLabel}</span><strong>{result.labor === null ? 'не рассчитано' : moneyText(result.labor)}</strong></div>
    <div className="estimate-subtotal"><span>Итого до НДС</span><strong>{result.total === null ? 'не рассчитано' : moneyText(result.total)}</strong></div>
    {vatRate !== null && vatRate > 0 && <div className="estimate-vat-line">
      <span>НДС {number(vatRate)} % {result.vatIncluded ? '(в т.ч.)' : '(сверху)'}</span>
      <strong>{result.vat === null ? 'не рассчитано' : moneyText(result.vat)}</strong>
    </div>}
    <div className="estimate-grand"><span>ИТОГО</span><strong className="estimate-total-value">{result.gross === null ? 'не рассчитано' : moneyText(result.gross)}</strong></div>
  </div>;
}

/** Строка редактора работ по видам; сумма — только для чтения. */
function WorksRow({ work, index, rounding, onUpdate, onRemove }: {
  work: WorkLine;
  index: number;
  rounding: number | null;
  onUpdate: (work: WorkLine, patch: Partial<WorkLine>) => void;
  onRemove: (work: WorkLine) => void;
}) {
  const total = workLineTotal(work, rounding);
  return <tr data-work-row={work.id}>
    <td className="works-name"><input type="text" value={work.name} aria-label={`Наименование работы ${index + 1}`} onChange={event => onUpdate(work, { name: event.target.value })} /></td>
    <td className="works-unit"><input type="text" value={work.unit} aria-label={`Единица работы ${index + 1}`} onChange={event => onUpdate(work, { unit: event.target.value })} /></td>
    <td className="works-quantity"><NumberField value={work.quantity} placeholder="—" ariaLabel={`Количество работы ${index + 1}`} onCommit={raw => onUpdate(work, { quantity: raw === '' ? null : nonNegativeOrNull(raw) })} /></td>
    <td className="works-price"><NumberField value={work.price} placeholder="—" ariaLabel={`Цена работы ${index + 1}`} onCommit={raw => onUpdate(work, { price: raw === '' ? null : nonNegativeOrNull(raw) })} /></td>
    <td className="works-sum">{total === null ? '—' : moneyText(total)}</td>
    <td className="works-remove"><button type="button" aria-label={`Удалить работу ${index + 1}`} title="Удалить работу" onClick={() => onRemove(work)}>×</button></td>
  </tr>;
}

/** Редактор работ по видам: строки «наименование, единица, количество, цена» и сумма без редактирования. */
function WorksEditor({ project, onChange }: { project: Project; onChange: (recipe: (project: Project) => void) => void }) {
  const works = project.estimate?.works ?? [];
  const rounding = normalizeRounding(project.estimate?.rounding);
  const updateWork = (target: WorkLine, patch: Partial<WorkLine>): void => {
    onChange(p => {
      const items = (p.estimate?.works ?? []).map(item => item.id === target.id ? { ...item, ...patch } : item);
      p.estimate = { ...(p.estimate ?? { laborPercent: null }), works: items };
    });
  };
  const addWork = (): void => {
    onChange(p => {
      const items = [...(p.estimate?.works ?? []), { id: uid(), name: '', unit: 'шт', quantity: null, price: null }];
      p.estimate = { ...(p.estimate ?? { laborPercent: null }), works: items };
    });
  };
  const removeWork = (target: WorkLine): void => {
    onChange(p => {
      const items = (p.estimate?.works ?? []).filter(item => item.id !== target.id);
      p.estimate = { ...(p.estimate ?? { laborPercent: null }), works: items };
    });
  };
  return <details className="works-editor">
    <summary>Работы по видам <span>{works.length}</span></summary>
    <div className="works-controls">
      <button type="button" className="works-add" onClick={addWork}>＋ Работа</button>
      <p className="help">Непустой список работ заменяет процент от материалов. Пустые количество или цена — «неизвестно», а не 0.</p>
    </div>
    <div className="table-scroll"><table className="works-table">
      <thead><tr><th>Наименование</th><th>Ед.</th><th>Количество</th><th>Цена, ₽</th><th>Сумма, ₽</th><th><span className="sr-only">Действия</span></th></tr></thead>
      <tbody>
        {works.map((work, index) => <WorksRow key={work.id} work={work} index={index} rounding={rounding} onUpdate={updateWork} onRemove={removeWork} />)}
        {!works.length && <tr><td colSpan={6}>Работ по видам нет. Добавьте строку — смета перейдёт в режим «по видам».</td></tr>}
      </tbody>
    </table></div>
  </details>;
}

/** Строка редактора справочника цен. */
function CatalogRow({ item, index, onUpdate, onRemove }: {
  item: PriceItem;
  index: number;
  onUpdate: (index: number, patch: Partial<PriceItem>) => void;
  onRemove: (item: PriceItem) => void;
}) {
  return <tr>
    <td className="catalog-kind"><select value={item.kind} aria-label={`Вид позиции ${index + 1}`} onChange={event => onUpdate(index, { kind: event.target.value as PriceKind })}>{(['equipment', 'cable', 'tray'] as const).map(kind => <option key={kind} value={kind}>{PRICE_KIND_LABELS[kind]}</option>)}</select></td>
    <td className="catalog-name"><input type="text" value={item.name} aria-label={`Наименование позиции ${index + 1}`} onChange={event => onUpdate(index, { name: event.target.value })} /></td>
    <td className="catalog-article"><input type="text" value={item.article ?? ''} aria-label={`Артикул позиции ${index + 1}`} onChange={event => onUpdate(index, { article: event.target.value })} /></td>
    <td className="catalog-manufacturer"><input type="text" value={item.manufacturer ?? ''} aria-label={`Производитель позиции ${index + 1}`} onChange={event => onUpdate(index, { manufacturer: event.target.value })} /></td>
    <td className="catalog-series"><input type="text" value={item.series ?? ''} aria-label={`Серия позиции ${index + 1}`} onChange={event => onUpdate(index, { series: event.target.value })} /></td>
    <td className="catalog-size"><input type="text" value={item.size ?? ''} aria-label={`Размер позиции ${index + 1}`} onChange={event => onUpdate(index, { size: event.target.value })} /></td>
    <td className="catalog-unit"><input type="text" value={item.unit} aria-label={`Единица позиции ${index + 1}`} onChange={event => onUpdate(index, { unit: event.target.value })} /></td>
    <td className="catalog-price"><NumberField value={item.price} placeholder="Не задано" ariaLabel={`Цена позиции ${index + 1}`} onCommit={raw => onUpdate(index, { price: raw === '' ? null : nonNegativeOrNull(raw) })} /></td>
    <td className="catalog-note"><input type="text" value={item.note} aria-label={`Примечание позиции ${index + 1}`} onChange={event => onUpdate(index, { note: event.target.value })} /></td>
    <td className="catalog-remove"><button type="button" aria-label={`Удалить позицию ${item.name}`} title="Удалить позицию" onClick={() => onRemove(item)}>×</button></td>
  </tr>;
}

/** Редактор справочника цен: дата прайса, импорт/экспорт JSON и таблица позиций. */
function CatalogEditor({ project, onChange, onMessage, onError }: {
  project: Project;
  onChange: (recipe: (project: Project) => void) => void;
  onMessage: (text: string) => void;
  onError: (text: string) => void;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const tableInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<(CatalogImportResult & { fileName: string }) | null>(null);
  const catalog = project.catalog ?? [];
  function updateCatalogItem(index: number, patch: Partial<PriceItem>): void {
    onChange(p => {
      const items = [...(p.catalog ?? [])];
      if (!items[index]) return;
      items[index] = { ...items[index], ...patch };
      p.catalog = items;
    });
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
  async function previewCatalogTable(file: File): Promise<void> {
    try {
      const rows = await readCatalogFile(file);
      const parsed = parseCatalogRows(rows);
      setPreview({ ...parsed, fileName: file.name });
      if (!parsed.items.length) onError(parsed.errors[0] ?? 'В таблице нет строк для импорта.');
    } catch (error) {
      onError(`Не удалось прочитать таблицу: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function applyPreview(): void {
    if (!preview) return;
    const result = mergeCatalog(catalog, preview.items);
    onChange(p => { p.catalog = result.catalog; });
    setPreview(null);
    onMessage(`Импорт «${preview.fileName}»: добавлено ${result.added}, обновлено ${result.updated}.`);
  }
  return <>
    <details className="catalog-editor">
      <summary>Справочник цен <span>{catalog.length}</span></summary>
      <div className="catalog-controls">
        <label className="field catalog-date">Дата прайса<input type="date" value={project.catalogDate ?? ''} aria-label="Дата прайса" onChange={event => onChange(p => { p.catalogDate = event.target.value || null; })} /></label>
        <div className="catalog-actions">
          <button type="button" className="catalog-export" onClick={() => void exportCatalog()}>Экспорт справочника</button>
          <button type="button" className="catalog-import" onClick={() => importInput.current?.click()}>Импорт JSON</button>
          <button type="button" className="catalog-import-table" onClick={() => tableInput.current?.click()}>Импорт XLSX/CSV</button>
          <button type="button" onClick={() => onChange(p => { p.catalog = [...(p.catalog ?? []), { id: uid(), kind: 'equipment', name: 'Новая позиция', unit: 'шт', price: null, note: '' }]; })}>＋ Позиция</button>
        </div>
      </div>
      {preview && <div className="catalog-preview">
        <div className="catalog-preview-head"><strong>Импорт: {preview.fileName}</strong><span>{preview.items.length} поз. · ошибок: {preview.errors.length}</span></div>
        <div className="table-scroll"><table className="catalog-preview-table">
          <thead><tr><th>Вид</th><th>Наименование</th><th>Артикул</th><th>Серия</th><th>Размер</th><th>Ед.</th><th>Цена</th></tr></thead>
          <tbody>{preview.items.slice(0, 5).map(item => <tr key={item.id}><td>{PRICE_KIND_LABELS[item.kind]}</td><td>{item.name}</td><td>{item.article || '—'}</td><td>{item.series || '—'}</td><td>{item.size || '—'}</td><td>{item.unit}</td><td>{item.price === null ? '—' : moneyText(item.price)}</td></tr>)}</tbody>
        </table></div>
        {preview.errors.length > 0 && <ul className="catalog-import-errors">{preview.errors.slice(0, 10).map((error, index) => <li key={index}>{error}</li>)}{preview.errors.length > 10 && <li>… и ещё {preview.errors.length - 10}</li>}</ul>}
        <div className="catalog-preview-actions"><button type="button" className="primary" onClick={applyPreview} disabled={!preview.items.length}>Импортировать ({preview.items.length})</button><button type="button" onClick={() => setPreview(null)}>Отмена</button></div>
      </div>}
      <div className="table-scroll"><table className="catalog-table">
        <thead><tr><th>Вид</th><th>Наименование</th><th>Артикул</th><th>Производитель</th><th>Серия</th><th>Размер</th><th>Ед.</th><th>Цена, ₽</th><th>Примечание</th><th /></tr></thead>
        <tbody>
          {catalog.map((item, index) => <CatalogRow key={item.id} item={item} index={index} onUpdate={updateCatalogItem} onRemove={removed => onChange(p => { p.catalog = (p.catalog ?? []).filter(entry => entry.id !== removed.id); })} />)}
          {!catalog.length && <tr><td colSpan={10}>Справочник пуст. Добавьте позиции или импортируйте JSON/XLSX/CSV.</td></tr>}
        </tbody>
      </table></div>
      <p className="help">Позиции справочника сопоставляются по виду и наименованию без учёта регистра. Цена «—» означает «неизвестно», а не 0. Пустое поле «Работы, %» также делает смету неполной.</p>
    </details>
    <input hidden ref={importInput} type="file" accept=".json,application/json" className="catalog-import-input" onChange={event => { const file = event.target.files?.[0]; if (file) void importCatalogFile(file); event.target.value = ''; }} />
    <input hidden ref={tableInput} type="file" accept=".xlsx,.xls,.csv,text/csv" className="catalog-import-table-input" onChange={event => { const file = event.target.files?.[0]; if (file) void previewCatalogTable(file); event.target.value = ''; }} />
  </>;
}

/**
 * Экран «Смета и коммерческое предложение»: расчёт по справочнику цен проекта,
 * процент работ и редактирование/импорт-экспорт самого справочника.
 */
export function EstimateScreen({ project, onChange, onMessage, onError }: {
  project: Project;
  onChange: (recipe: (project: Project) => void) => void;
  onMessage: (text: string) => void;
  onError: (text: string) => void;
}) {
  const result = useMemo(() => estimate(project), [project]);
  const catalogDateText = project.catalogDate || result.catalogDate || 'не задана';
  return <section className="document-view estimate-view">
    <div className="document-title">
      <div>
        <span className="eyebrow">ДОКУМЕНТАЦИЯ</span>
        <h1>Смета и коммерческое предложение</h1>
        <p>Стоимость материалов по справочнику цен, работы процентом от материалов или по видам, НДС и округление. Неизвестные цены не подменяются нулём.</p>
      </div>
      <EstimateStatus result={result} catalogDateText={catalogDateText} />
    </div>
    <EstimateControls project={project} onChange={onChange} />
    {!result.complete && <EstimateWarnings warnings={result.warnings} />}
    {result.sections.map(section => <EstimateSection key={section.kind} section={section} result={result} />)}
    <EstimateTotals result={result} />
    <p className="document-note">Смета считается по справочнику цен проекта; ручная цена кабеля приоритетнее справочника. Дата прайса: {catalogDateText}.{project.estimate?.note ? ` Примечание: ${project.estimate.note}.` : ''} Пустые цены не подменяются нулём — они помечены «—» и делают смету неполной.</p>
    <WorksEditor project={project} onChange={onChange} />
    <CatalogEditor project={project} onChange={onChange} onMessage={onMessage} onError={onError} />
  </section>;
}
