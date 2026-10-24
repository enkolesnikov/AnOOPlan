import type { Project, Route, Segment, Vertex } from '../model';
import type { TrayFillResult } from '../engine';
import { suggestSegmentSection } from '../engine';
import { hasSectionOverride, isDiameterRoute, segmentSectionLabel } from '../route-kinds';
import { field } from './fields';
import { fillPercentText, fillStatus, number } from './format';
import { floorSelect } from './selects';

type Mutate = (fn: (project: Project) => void) => void;

interface SegmentEditorProps {
  project: Project;
  route: Route;
  segment: Segment;
  index: number;
  fill: TrayFillResult;
  mutate: Mutate;
  segmentField: (segment: Segment, endpoint: 'a' | 'b', key: keyof Vertex, value: unknown) => void;
  setMessage: (message: string) => void;
}

/**
 * Свойства сегмента трассы: геометрия, запасы и необязательное сечение КНС на участке.
 * Своё сечение (лоток/труба другого размера) переопределяет размеры трассы только здесь.
 */
export function SegmentEditor({ project, route, segment, index, fill, mutate, segmentField, setMessage }: SegmentEditorProps) {
  const update = (change: (target: Segment) => void) => mutate(p => {
    const target = p.routes.find(r => r.id === route.id)?.segments.find(s => s.id === segment.id);
    if (target) change(target);
  });
  const row = fill.segments.find(entry => entry.segmentId === segment.id);
  const overridden = hasSectionOverride(segment);
  const diameter = isDiameterRoute(route);
  const suggestion = suggestSegmentSection(project, route, segment);
  const segmentName = `${route.number}.${index + 1}`;

  function applySuggestion() {
    if (!suggestion) return;
    update(target => {
      target.trayWidthMm = suggestion.widthMm;
      if (suggestion.heightMm === null) delete target.trayHeightMm;
      else target.trayHeightMm = suggestion.heightMm;
      delete target.trayAreaMm2;
    });
    setMessage(`Сегмент ${segmentName}: подобрано сечение ${suggestion.label}.`);
  }

  function resetSection() {
    update(target => {
      delete target.trayWidthMm;
      delete target.trayHeightMm;
      delete target.trayAreaMm2;
    });
    setMessage(`Сегмент ${segmentName}: сечение как у трассы.`);
  }

  return (
    <details className="segment-editor">
      <summary>Сегмент {segmentName} {segment.a.floorId !== segment.b.floorId ? ' · стояк ↕' : ''}</summary>
      <label className="field">Геометрия
        <select value={segment.mode} onChange={e => update(target => { target.mode = e.target.value as Segment['mode']; })}>
          <option value="orthogonal">Ортогональная</option>
          <option value="spatial">Пространственная</option>
        </select>
      </label>
      {(['a', 'b'] as const).map(end => (
        <div className="endpoint" key={end}>
          <strong>{end === 'a' ? 'Начало' : 'Конец'}</strong>
          <label className="field">Этаж{floorSelect(project, segment[end].floorId, value => segmentField(segment, end, 'floorId', value))}</label>
          <div className="field-pair">
            {field('X', segment[end].x, v => segmentField(segment, end, 'x', Number(v)), true)}
            {field('Y', segment[end].y, v => segmentField(segment, end, 'y', Number(v)), true)}
          </div>
          {field('Высота, м', segment[end].height, v => segmentField(segment, end, 'height', v === '' ? null : Number(v)), true)}
        </div>
      ))}
      <div className="field-pair">
        {field('Запас, %', segment.reservePercent, v => update(target => { target.reservePercent = Number(v); }), true)}
        {field('Запас, м', segment.reserveFixed, v => update(target => { target.reserveFixed = Number(v); }), true)}
      </div>

      <div className="section-label">Сечение КНС на сегменте <span>{segmentSectionLabel(route, segment)}{overridden ? ' · своё' : ''}</span></div>
      {diameter
        ? (
          <div className="field-pair">
            {field('Внутренний диаметр, мм', segment.trayWidthMm ?? null, v => update(target => { target.trayWidthMm = v === '' ? null : Number(v); }), true)}
            {field('Площадь сечения, мм²', segment.trayAreaMm2 ?? null, v => update(target => { target.trayAreaMm2 = v === '' ? null : Number(v); }), true)}
          </div>
        )
        : (
          <>
            <div className="field-pair">
              {field('Ширина, мм', segment.trayWidthMm ?? null, v => update(target => { target.trayWidthMm = v === '' ? null : Number(v); }), true)}
              {field('Высота борта, мм', segment.trayHeightMm ?? null, v => update(target => { target.trayHeightMm = v === '' ? null : Number(v); }), true)}
            </div>
            {field('Площадь сечения, мм²', segment.trayAreaMm2 ?? null, v => update(target => { target.trayAreaMm2 = v === '' ? null : Number(v); }), true)}
          </>
        )}
      <p className="help">Пустое поле — размер трассы. Заполните, если на этом участке другой лоток или труба: заполнение, схема трасс и спецификация КНС учтут своё сечение.</p>
      <div className="tray-fill-row segment-fill">
        <strong>Заполнение</strong>
        <span>{fillPercentText(row?.fillPercent)}</span>
        <em>{row ? fillStatus(row.status) : 'нет данных'}</em>
        <small>{row?.sectionLabel && row.sectionLabel !== '—' ? `${row.sectionLabel} · ${number(row.trayAreaMm2)} мм²` : ''}</small>
      </div>
      {row?.warnings?.length ? <small>{row.warnings.join(' ')}</small> : null}
      <div className="chip-row">
        <button type="button" disabled={!suggestion} title="Минимальное стандартное сечение с заполнением ≤ 40 % по кабелям этого участка" onClick={applySuggestion}>Подобрать сечение сегмента</button>
        <button type="button" disabled={!overridden} onClick={resetSection}>Как у трассы</button>
      </div>
      <button className="danger" onClick={() => {
        const linked = project.cables.filter(c => c.segmentIds.includes(segment.id));
        if (window.confirm(`Удалить сегмент? ${linked.length ? `Связанных кабелей: ${linked.length}. Они будут удалены.` : ''}`)) {
          mutate(p => {
            const target = p.routes.find(r => r.id === route.id)!;
            target.segments = target.segments.filter(s => s.id !== segment.id);
            p.cables = p.cables.filter(c => !c.segmentIds.includes(segment.id));
          });
        }
      }}>Удалить сегмент</button>
    </details>
  );
}
