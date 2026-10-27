import type { CSSProperties } from 'react';
import type { RouteSummaryResult } from '../engine';
import { routeSectionsText } from '../engine';
import { FILL_STATUS_LABELS, number } from './format';

export function IssueList({ value }: { value: unknown }) {
  if (Array.isArray(value)) return value.length ? <ul className="issues-list">{value.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul> : <div className="validation-good">✓ Структурных замечаний не найдено. Проверьте рабочую документацию перед применением.</div>;
  return <pre className="data-json">{JSON.stringify(value, null, 2)}</pre>;
}
export const SPEC_LABELS: Record<string, string> = { cables: 'Кабельная продукция', cable: 'Кабельная продукция', infrastructure: 'Кабельная инфраструктура', routes: 'Кабельная инфраструктура', routeSummary: 'Схема трасс', groups: 'Итого по типам КНС', errors: 'Замечания', warnings: 'Предупреждения', name: 'Наименование', brand: 'Марка', type: 'Тип', purpose: 'Назначение', number: 'Обозначение', quantity: 'Количество', length: 'Длина, м', total: 'Всего, м', totalLength: 'Всего, м', complete: 'Полный расчёт', unit: 'Ед.', routeId: 'ID трассы', cableId: 'ID кабеля', segmentId: 'ID сегмента', reserve: 'Запас', geometry: 'Геометрия, м', totalQuantity: 'Количество', totalMeters: 'Всего, м', incomplete: 'Неполные', id: 'ID', trayFill: 'Заполнение КНС', route: 'Трасса', segment: 'Сегмент', routeType: 'Тип трассы', tray: 'КНС, мм', trayAreaMm2: 'Площадь КНС, мм²', lines: 'Линий', areaMm2: 'Площадь кабелей, мм²', fillPercent: 'Заполнение, %', status: 'Статус', maxFillPercent: 'Макс. заполнение, %', overSegments: 'Сегментов с превышением', unknownCables: 'Кабелей без сечения', usedAreaMm2: 'Занято, мм²', overridden: 'Своё сечение', equipment: 'Оборудование', model: 'Модель', floor: 'Этаж', floors: 'Этажи', segments: 'Сегментов', height: 'Высота, м', width: 'Ширина, мм', depth: 'Глубина, мм', photos: 'Фото', article: 'Артикул', manufacturer: 'Производитель', series: 'Серия', size: 'Размер', price: 'Цена, ₽', cost: 'Стоимость, ₽', subsystem: 'Подсистема', angles: 'Углы', section: 'Сечение', note: 'Примечание', comment: 'Комментарий' };
const labels = SPEC_LABELS;
/** Схема трасс: метраж по трассам, их сечениям и количество углов коробов. */
export function RouteSchemeTable({ value }: { value: RouteSummaryResult }) {
  if (!value.routes.length) return <p className="help">Трасс нет.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Трасса</th><th>Тип КНС</th><th>Сечения</th><th>Длина, м</th><th>Сегментов</th><th>Углы</th></tr></thead>
        <tbody>
          {value.routes.map(row => (
            <tr key={row.id}>
              <td><strong>{row.number}</strong></td>
              <td>{row.type || '—'}</td>
              <td>{routeSectionsText(row.sections, number)}</td>
              <td>{number(row.length)}</td>
              <td>{row.segments}</td>
              <td>{row.group === 'Кабель-канал' ? row.angles.total : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {value.groups.map(group => (
            <tr key={group.group}>
              <td colSpan={2}>Итого: {group.group}</td>
              <td>{group.routes} трасс.</td>
              <td>{number(group.length)}</td>
              <td>—</td>
              <td>{group.group === 'Кабель-канал' ? group.angles.total : '—'}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

export function SpecificationTables({ value }: { value: unknown }) {
  function render(data: unknown, key: string): React.ReactNode {
    // Схема трасс — отдельная таблица: плоский список строк и итоги по типам КНС.
    if (key === 'routeSummary' && data !== null && typeof data === 'object' && Array.isArray((data as RouteSummaryResult).routes)) {
      return <RouteSchemeTable value={data as RouteSummaryResult} />;
    }
    if (Array.isArray(data)) {
      if (!data.length) return <p className="help">Нет данных.</p>;
      if (data.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) {
        const rows = data as Record<string, unknown>[]; const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
        return <div className="table-scroll"><table><thead><tr>{columns.map(col => <th key={col}>{labels[col] || 'Дополнительно'}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(col => <td key={col}>{typeof row[col] === 'number' ? number(row[col]) : typeof row[col] === 'boolean' ? row[col] ? 'Да' : 'Нет' : row[col] === null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : col === 'status' && typeof row[col] === 'string' ? FILL_STATUS_LABELS[row[col]] ?? row[col] : String(row[col] ?? '—')}</td>)}</tr>)}</tbody></table></div>;
      }
      return <IssueList value={data} />;
    }
    if (data && typeof data === 'object') return <>{Object.entries(data).map(([name, item]) => <section className="spec-section" key={name}><h2>{labels[name] || 'Дополнительные данные'}</h2>{render(item, name)}</section>)}</>;
    return <div className="spec-value" style={{ '--spec-key': key } as CSSProperties}>{typeof data === 'number' ? number(data) : String(data ?? '—')}</div>;
  }
  return <div className="specifications">{render(value, 'root')}</div>;
}
