import { useMemo, useRef, useState } from 'react';
import type { PriceItem, PriceKind, Project } from '../model';
import { estimate, isCatalogDate, normalizeCatalog } from '../estimate';
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
const nonNegativeOrNull = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Статус сметы и дата прайса в шапке экрана. */
function EstimateStatus({ complete, catalogDateText }: { complete: boolean; catalogDateText: string }) {
  return <div className="estimate-status">
    <span className={`badge ${complete ? 'good' : 'warn'}`}>{complete ? 'Смета рассчитана' : 'Смета неполная'}</span>
    <small>Дата прайса: <strong>{catalogDateText}</strong></small>
  </div>;
}

/** Процент работ и примечание к смете. */
function EstimateControls({ project, onChange }: { project: Project; onChange: (recipe: (project: Project) => void) => void }) {
  const setEstimate = (patch: { laborPercent?: number | null; note?: string }): void => {
    onChange(p => { p.estimate = { ...(p.estimate ?? { laborPercent: null }), ...patch }; });
  };
  return <div className="estimate-controls">
    <label className="field estimate-labor">Работы, %<NumberField value={project.estimate?.laborPercent ?? null} ariaLabel="Работы, %" placeholder="Не задано" onCommit={raw => setEstimate({ laborPercent: raw === '' ? null : nonNegativeOrNull(raw) })} /></label>
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
function EstimateSection({ section, laborPercent }: { section: EstimateSectionData; laborPercent: number | null }) {
  return <section className="estimate-section">
    <div className="estimate-section-head">
      <h2>{section.title}</h2>
      <span className={`badge ${section.complete ? 'good' : 'warn'}`}>{section.complete ? 'раздел рассчитан' : 'неполный раздел'}</span>
    </div>
    {section.kind === 'work' ? <WorkSection section={section} laborPercent={laborPercent} /> : <SectionTable section={section} />}
  </section>;
}

/** Итоги сметы: материалы, работы и общий итог. */
function EstimateTotals({ result }: { result: EstimateResult }) {
  return <div className="estimate-totals">
    <div><span>Материалы</span><strong>{result.materials === null ? 'не рассчитано' : moneyText(result.materials)}</strong></div>
    <div><span>Работы{result.laborPercent === null ? '' : ` (${number(result.laborPercent)} %)`}</span><strong>{result.labor === null ? 'не рассчитано' : moneyText(result.labor)}</strong></div>
    <div className="estimate-grand"><span>ИТОГО</span><strong className="estimate-total-value">{result.total === null ? 'Смета не рассчитана' : moneyText(result.total)}</strong></div>
  </div>;
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
        <p>Стоимость материалов по справочнику цен и работы процентом от материалов. Неизвестные цены не подменяются нулём.</p>
      </div>
      <EstimateStatus complete={result.complete} catalogDateText={catalogDateText} />
    </div>
    <EstimateControls project={project} onChange={onChange} />
    {!result.complete && <EstimateWarnings warnings={result.warnings} />}
    {result.sections.map(section => <EstimateSection key={section.kind} section={section} laborPercent={result.laborPercent} />)}
    <EstimateTotals result={result} />
    <p className="document-note">Смета считается по справочнику цен проекта; ручная цена кабеля приоритетнее справочника. Дата прайса: {catalogDateText}.{project.estimate?.note ? ` Примечание: ${project.estimate.note}.` : ''} Пустые цены не подменяются нулём — они помечены «—» и делают смету неполной.</p>
    <CatalogEditor project={project} onChange={onChange} onMessage={onMessage} onError={onError} />
  </section>;
}
