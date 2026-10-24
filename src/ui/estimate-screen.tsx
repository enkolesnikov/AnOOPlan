import { useMemo, useRef } from 'react';
import type { PriceItem, PriceKind, Project } from '../model';
import { estimate, isCatalogDate, normalizeCatalog } from '../estimate';
import { createUuid as uid } from '../compat';
import { number } from './format';
import { saveBlobOnDevice } from './native';
import { NumberField } from './number-field';


const PRICE_KIND_LABELS: Record<PriceKind, string> = { equipment: 'Оборудование', cable: 'Кабель', tray: 'Лоток' };
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
  const importInput = useRef<HTMLInputElement>(null);
  const catalog = project.catalog ?? [];
  function updateCatalogItem(index: number, patch: Partial<PriceItem>): void {
    onChange(p => {
      const items = [...(p.catalog ?? [])];
      if (!items[index]) return;
      items[index] = { ...items[index], ...patch };
      p.catalog = items;
    });
  }
  function setEstimate(patch: { laborPercent?: number | null; note?: string }): void {
    onChange(p => { p.estimate = { ...(p.estimate ?? { laborPercent: null }), ...patch }; });
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
  const catalogDateText = project.catalogDate || result.catalogDate || 'не задана';
  return <section className="document-view estimate-view">
    <div className="document-title">
      <div>
        <span className="eyebrow">ДОКУМЕНТАЦИЯ</span>
        <h1>Смета и коммерческое предложение</h1>
        <p>Стоимость материалов по справочнику цен и работы процентом от материалов. Неизвестные цены не подменяются нулём.</p>
      </div>
      <div className="estimate-status">
        <span className={`badge ${result.complete ? 'good' : 'warn'}`}>{result.complete ? 'Смета рассчитана' : 'Смета неполная'}</span>
        <small>Дата прайса: <strong>{catalogDateText}</strong></small>
      </div>
    </div>
    <div className="estimate-controls">
      <label className="field estimate-labor">Работы, %<NumberField value={project.estimate?.laborPercent ?? null} ariaLabel="Работы, %" placeholder="Не задано" onCommit={raw => setEstimate({ laborPercent: raw === '' ? null : nonNegativeOrNull(raw) })} /></label>
      <label className="field estimate-note-field">Примечание к смете<input type="text" value={project.estimate?.note ?? ''} placeholder="Например: Цены действительны 30 дней" onChange={event => setEstimate({ note: event.target.value })} /></label>
    </div>
    {!result.complete && <div className="estimate-warnings"><strong>Смета неполная</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {result.sections.map(section => <section className="estimate-section" key={section.kind}>
      <div className="estimate-section-head">
        <h2>{section.title}</h2>
        <span className={`badge ${section.complete ? 'good' : 'warn'}`}>{section.complete ? 'раздел рассчитан' : 'неполный раздел'}</span>
      </div>
      {section.kind === 'work' ? <div className="estimate-work-summary">
        <p>Работы {result.laborPercent === null ? 'не рассчитаны: не задан процент.' : `— ${number(result.laborPercent)} % от стоимости материалов.`}</p>
        <div className="estimate-section-total"><span>Итого по разделу</span><strong>{section.total === null ? 'не рассчитано' : moneyText(section.total)}</strong></div>
        {result.laborPercent !== null && section.total === null && <p className="help">Стоимость работ не рассчитана: сначала должна быть известна стоимость материалов.</p>}
      </div> : <>
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
      </>}
    </section>)}
    <div className="estimate-totals">
      <div><span>Материалы</span><strong>{result.materials === null ? 'не рассчитано' : moneyText(result.materials)}</strong></div>
      <div><span>Работы{result.laborPercent === null ? '' : ` (${number(result.laborPercent)} %)`}</span><strong>{result.labor === null ? 'не рассчитано' : moneyText(result.labor)}</strong></div>
      <div className="estimate-grand"><span>ИТОГО</span><strong className="estimate-total-value">{result.total === null ? 'Смета не рассчитана' : moneyText(result.total)}</strong></div>
    </div>
    <p className="document-note">Смета считается по справочнику цен проекта; ручная цена кабеля приоритетнее справочника. Дата прайса: {catalogDateText}.{project.estimate?.note ? ` Примечание: ${project.estimate.note}.` : ''} Пустые цены не подменяются нулём — они помечены «—» и делают смету неполной.</p>
    <details className="catalog-editor">
      <summary>Справочник цен <span>{catalog.length}</span></summary>
      <div className="catalog-controls">
        <label className="field catalog-date">Дата прайса<input type="date" value={project.catalogDate ?? ''} aria-label="Дата прайса" onChange={event => onChange(p => { p.catalogDate = event.target.value || null; })} /></label>
        <div className="catalog-actions">
          <button type="button" className="catalog-export" onClick={() => void exportCatalog()}>Экспорт справочника</button>
          <button type="button" className="catalog-import" onClick={() => importInput.current?.click()}>Импорт справочника</button>
          <button type="button" onClick={() => onChange(p => { p.catalog = [...(p.catalog ?? []), { id: uid(), kind: 'equipment', name: 'Новая позиция', unit: 'шт', price: null, note: '' }]; })}>＋ Позиция</button>
        </div>
      </div>
      <div className="table-scroll"><table className="catalog-table">
        <thead><tr><th>Вид</th><th>Наименование</th><th>Ед.</th><th>Цена, ₽</th><th>Примечание</th><th /></tr></thead>
        <tbody>
          {catalog.map((item, index) => <tr key={item.id}>
            <td className="catalog-kind"><select value={item.kind} aria-label={`Вид позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { kind: event.target.value as PriceKind })}>{(['equipment', 'cable', 'tray'] as const).map(kind => <option key={kind} value={kind}>{PRICE_KIND_LABELS[kind]}</option>)}</select></td>
            <td className="catalog-name"><input type="text" value={item.name} aria-label={`Наименование позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { name: event.target.value })} /></td>
            <td className="catalog-unit"><input type="text" value={item.unit} aria-label={`Единица позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { unit: event.target.value })} /></td>
            <td className="catalog-price"><NumberField value={item.price} placeholder="Не задано" ariaLabel={`Цена позиции ${index + 1}`} onCommit={raw => updateCatalogItem(index, { price: raw === '' ? null : nonNegativeOrNull(raw) })} /></td>
            <td className="catalog-note"><input type="text" value={item.note} aria-label={`Примечание позиции ${index + 1}`} onChange={event => updateCatalogItem(index, { note: event.target.value })} /></td>
            <td className="catalog-remove"><button type="button" aria-label={`Удалить позицию ${item.name}`} title="Удалить позицию" onClick={() => onChange(p => { p.catalog = (p.catalog ?? []).filter(entry => entry.id !== item.id); })}>×</button></td>
          </tr>)}
          {!catalog.length && <tr><td colSpan={6}>Справочник пуст. Добавьте позиции или импортируйте JSON.</td></tr>}
        </tbody>
      </table></div>
      <p className="help">Позиции справочника сопоставляются по виду и наименованию без учёта регистра. Цена «—» означает «неизвестно», а не 0. Пустое поле «Работы, %» также делает смету неполной.</p>
    </details>
    <input hidden ref={importInput} type="file" accept=".json,application/json" className="catalog-import-input" onChange={event => { const file = event.target.files?.[0]; if (file) void importCatalogFile(file); event.target.value = ''; }} />
  </section>;
}
