import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createDemoProject } from '../demo';
import { readDiagnostics } from '../diagnostics';
import { readLocalProjects } from '../local-projects';
import { api } from './api';
import { EquipmentIcon } from './equipment-icon';
import { number } from './format';
import { routeColor, routeKindOf } from '../route-kinds';
import { routeAngleStats, routeLength, routeSummary } from '../engine';
import { freshFloor, freshProject } from './project-factory';
import { matchesQuery, searchCaption } from './search';
import { allIds, bulkKind, isBulkTab, pageSlice, toggleId } from './multi-select';
import type { ObjectKind } from './types';
import type { AppUi } from './use-app-controller';

type Tab = AppUi['tab'];
type Project = AppUi['project'];

/** Подпись сайдбара со счётчиком этажей. */
function SidebarTitle({ floors }: { floors: number }) {
  return <div className="sidebar-title">Структура проекта <span>{floors} эт.</span></div>;
}

/** Переключатель вкладок структуры проекта. */
function StructureTabs({ project, tab, onTab }: { project: Project; tab: Tab; onTab: (tab: Tab) => void }) {
  const tabs = [['floors', 'Этажи'], ['equipment', 'Оборуд.'], ['routes', 'Трассы'], ['cables', 'Кабели'], ['pins', 'Зам.']] as const;
  return <div className="structure-tabs">{tabs.map(([id, name]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => onTab(id)}>{name}<span>{project[id].length}</span></button>)}</div>;
}

/** Сводка метража по типам КНС — видна только на вкладке «Трассы». */
function RouteSummary({ project }: { project: Project }) {
  const summary = routeSummary(project);
  return <div className="route-summary">{summary.groups.map(group => <span key={group.group}><strong>{number(group.length)} м</strong> {group.group}{group.group === 'Кабель-канал' ? ` · углов ${group.angles.total}` : ''}</span>)}</div>;
}

/** Состояние строки в режиме массового выбора. */
function rowBulk(ui: AppUi, tab: Tab, kind: ObjectKind, id: string) {
  const ids = ui.multi?.tab === tab ? ui.multi.ids : null;
  return {
    active: ids !== null,
    checked: ids?.includes(id) ?? false,
    toggle: () => { if (ids) ui.setMulti({ tab, ids: toggleId(ids, id) }); },
    menu: (event: MouseEvent) => { event.preventDefault(); ui.setSheet({ kind, id }); },
  };
}

/** Строка этажа: номер, подложка, отметка и калибровка. */
function FloorRow({ ui, floor: item, index }: { ui: AppUi; floor: AppUi['project']['floors'][number]; index: number }) {
  const { floor, setFloorId, setSelection, setMenuOpen } = ui;
  return <button className={`object-row ${floor?.id === item.id ? 'selected' : ''}`} onClick={() => { setFloorId(item.id); setSelection(null); setMenuOpen(false); }}>
    <span className="object-icon">{String(index + 1).padStart(2, '0')}</span>
    <span>
      <strong>{item.name}</strong>
      <small>{item.pdfId ? `PDF · страница ${item.page}` : 'Без подложки'} · {item.elevation === null ? 'отметка не задана' : `${number(item.elevation)} м`}</small>
    </span>
    <i className={item.metersPerUnit ? 'dot calibrated' : 'dot'} />
  </button>;
}

/** Строка оборудования: иконка типа, номер, наименование. */
function EquipmentRow({ ui, item }: { ui: AppUi; item: AppUi['project']['equipment'][number] }) {
  const { selection, setSelection, setFloorId, setView, setMenuOpen } = ui;
  const bulk = rowBulk(ui, 'equipment', 'equipment', item.id);
  return <button data-kind="equipment" data-id={item.id} data-bulk={bulk.checked ? 'true' : undefined} className={`object-row ${!bulk.active && selection?.id === item.id ? 'selected' : ''}`} onClick={() => { if (bulk.active) { bulk.toggle(); return; } setSelection({ kind: 'equipment', id: item.id }); setFloorId(item.floorId); setView('plan'); setMenuOpen(false); }} onContextMenu={bulk.menu}>
    <span className="object-icon equipment-icon"><EquipmentIcon item={item} /></span>
    <span>
      <strong>{item.number}</strong>
      <small>{item.name}</small>
    </span>
  </button>;
}

/** Строка трассы: цвет, тип, длина, сегменты и углы коробов. */
function RouteRow({ ui, item }: { ui: AppUi; item: AppUi['project']['routes'][number] }) {
  const { project, selection, setSelection, setFloorId, setView, setMenuOpen } = ui;
  const bulk = rowBulk(ui, 'routes', 'route', item.id);
  return <button data-kind="route" data-id={item.id} data-bulk={bulk.checked ? 'true' : undefined} className={`object-row ${!bulk.active && selection?.id === item.id ? 'selected' : ''}`} onClick={() => { if (bulk.active) { bulk.toggle(); return; } setSelection({ kind: 'route', id: item.id }); if (item.segments[0]) setFloorId(item.segments[0].a.floorId); setView('plan'); setMenuOpen(false); }} onContextMenu={bulk.menu}>
    <span className="object-icon route-icon" style={{ color: routeColor(item) }}>⌁</span>
    <span>
      <strong>{item.number} · {item.type}</strong>
      <small>{number(routeLength(project, item))} м · {item.segments.length} сегм.{routeKindOf(item.type) === 'trunking' ? ` · углов ${routeAngleStats(item).total}` : ''}</small>
    </span>
  </button>;
}

/** Строка замечания: номер, текст и статус. */
function PinRow({ ui, item }: { ui: AppUi; item: AppUi['project']['pins'][number] }) {
  const { selection, setSelection, setFloorId, setView, setMenuOpen } = ui;
  const bulk = rowBulk(ui, 'pins', 'pin', item.id);
  return <button data-kind="pin" data-id={item.id} data-bulk={bulk.checked ? 'true' : undefined} className={`object-row ${!bulk.active && selection?.id === item.id ? 'selected' : ''}`} onClick={() => { if (bulk.active) { bulk.toggle(); return; } setSelection({ kind: 'pin', id: item.id }); setFloorId(item.floorId); setView('plan'); setMenuOpen(false); }} onContextMenu={bulk.menu}>
    <span className="object-icon pin-icon">📍</span>
    <span>
      <strong>{item.number}</strong>
      <small>{item.comment || 'Без текста'} · {item.status === 'closed' ? 'закрыто' : 'открыто'}</small>
    </span>
  </button>;
}

/** Строка кабеля: марка, итоговый метраж и полнота расчёта. */
function CableRow({ ui, item }: { ui: AppUi; item: AppUi['project']['cables'][number] }) {
  const { selection, setSelection, setMenuOpen, cableCalcs } = ui;
  const calc = cableCalcs.get(item.id)!;
  const bulk = rowBulk(ui, 'cables', 'cable', item.id);
  return <button data-kind="cable" data-id={item.id} data-bulk={bulk.checked ? 'true' : undefined} className={`object-row ${!bulk.active && selection?.id === item.id ? 'selected' : ''}`} onClick={() => { if (bulk.active) { bulk.toggle(); return; } setSelection({ kind: 'cable', id: item.id }); setMenuOpen(false); }} onContextMenu={bulk.menu}>
    <span className="object-icon cable-icon">↝</span>
    <span>
      <strong>{item.number} · {item.brand || item.name}</strong>
      <small>{calc.complete ? `${number(calc.total)} м` : 'Неполный расчёт'}</small>
    </span>
    <i className={calc.complete ? 'dot calibrated' : 'dot warning'} />
  </button>;
}

/** Поле поиска по объектам активной вкладки; Ctrl+K фокусирует его. */
function SearchBox({ ui }: { ui: AppUi }) {
  const { search, setSearch } = ui;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    window.addEventListener('cableplan:focus-search', focus);
    return () => window.removeEventListener('cableplan:focus-search', focus);
  }, []);
  return <div className="sidebar-search">
    <input
      ref={inputRef}
      type="search"
      value={search}
      placeholder="Поиск: №, тип, примечание"
      aria-label="Поиск по объектам"
      onChange={event => setSearch(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); inputRef.current?.blur(); } }}
    />
    {search ? <button type="button" aria-label="Очистить поиск" onClick={() => { setSearch(''); inputRef.current?.focus(); }}>×</button> : null}
  </div>;
}

/** Список объектов активной вкладки с фильтром и порционной отрисовкой. */
function ObjectList({ ui }: { ui: AppUi }) {
  const { tab, project, listPressDown, moveLongPress, cancelLongPress, search } = ui;
  const [limit, setLimit] = useState(80);
  useEffect(() => { setLimit(80); }, [tab, search]);
  const floors = project.floors.filter(item => matchesQuery(search, [item.name]));
  const equipment = project.equipment.filter(item => matchesQuery(search, [item.number, item.name, item.type, item.note]));
  const routes = project.routes.filter(item => matchesQuery(search, [item.number, item.type, item.note, item.subsystem]));
  const pins = project.pins.filter(item => matchesQuery(search, [item.number, item.comment]));
  const cables = project.cables.filter(item => matchesQuery(search, [item.number, item.brand, item.name, item.purpose, item.note]));
  const found = tab === 'floors' ? floors.length : tab === 'equipment' ? equipment.length : tab === 'routes' ? routes.length : tab === 'pins' ? pins.length : cables.length;
  const total = project[tab].length;
  const caption = searchCaption(search, found, total);
  const emptyText = search.trim() ? `Ничего не найдено по «${search.trim()}».` : 'Объектов пока нет.';
  const rows = tab === 'floors' ? pageSlice(floors, limit).map((item, index) => <FloorRow key={item.id} ui={ui} floor={item} index={index} />)
    : tab === 'equipment' ? pageSlice(equipment, limit).map(item => <EquipmentRow key={item.id} ui={ui} item={item} />)
      : tab === 'routes' ? pageSlice(routes, limit).map(item => <RouteRow key={item.id} ui={ui} item={item} />)
        : tab === 'pins' ? pageSlice(pins, limit).map(item => <PinRow key={item.id} ui={ui} item={item} />)
          : pageSlice(cables, limit).map(item => <CableRow key={item.id} ui={ui} item={item} />);
  return <div className="object-list" onPointerDown={listPressDown} onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}>
    {caption ? <div className="search-count">{caption}</div> : null}
    {rows}
    {found === 0 && <div className="empty-list">{emptyText}{!search.trim() && <><br />Добавьте их на плане.</>}</div>}
    {found > limit && <button type="button" className="show-more" onClick={() => setLimit(value => value + 100)}>Показать ещё ({found - limit})</button>}
  </div>;
}

/** Панель массового выбора: режим, «все», удаление и перенос на этаж. */
function MultiControls({ ui }: { ui: AppUi }) {
  const { tab, multi, setMulti, project, removeMany, moveMany } = ui;
  if (!isBulkTab(tab)) return null;
  const kind = bulkKind(tab)!;
  const active = multi?.tab === tab;
  const ids = active ? multi.ids : [];
  const all = allIds(project[tab] as Array<{ id: string }>);
  return <div className="multi-controls">
    <button type="button" className={active ? 'active' : ''} onClick={() => setMulti(active ? null : { tab, ids: [] })}>{active ? 'Отменить выбор' : 'Выбрать'}</button>
    {active && <>
      <button type="button" onClick={() => setMulti({ tab, ids: all })}>Все ({all.length})</button>
      {ids.length > 0 && <button type="button" className="danger" onClick={() => removeMany(kind, ids)}>Удалить ({ids.length})</button>}
      {(tab === 'equipment' || tab === 'pins') && ids.length > 0 && <select aria-label="Перенести на этаж" value="" onChange={event => { const floorId = event.target.value; if (floorId) moveMany(tab === 'equipment' ? 'equipment' : 'pin', ids, floorId); }}>
        <option value="">На этаж…</option>
        {project.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
      </select>}
    </>}
  </div>;
}

/** Кнопки добавления объектов активной вкладки. */
function SidebarActions({ ui }: { ui: AppUi }) {
  const { tab, project, floor, busy, mutate, setFloorId, setSelection, upload, setView, setTool } = ui;
  if (tab === 'floors') {
    return <div className="sidebar-actions">
      <button onClick={() => { const item = freshFloor(`Этаж ${project.floors.length + 1}`); mutate(p => p.floors.push(item)); setFloorId(item.id); setSelection(null); }}>＋ Добавить этаж</button>
      <button onClick={() => upload.current?.click()} disabled={!floor || busy}>↑ Загрузить PDF</button>
    </div>;
  }
  return <div className="sidebar-actions">
    <button onClick={() => { setView('plan'); setTool(tab === 'equipment' ? 'equipment' : tab === 'routes' ? 'route' : tab === 'pins' ? 'pin' : 'cable'); }}>＋ {tab === 'equipment' ? 'Оборудование на плане' : tab === 'routes' ? 'Начертить трассу' : tab === 'pins' ? 'Замечание на плане' : 'Создать кабель'}</button>
  </div>;
}

/** Действия с проектом: новый, открыть, импорт JSON, учебный проект. */
function ProjectActions({ ui }: { ui: AppUi }) {
  const { busy, mayLeave, load, setMenuOpen, setProjects, staticMode, restoreInput, run, setMessage } = ui;
  return <div className="sidebar-project">
    <button onClick={() => { setMenuOpen(false); if (mayLeave()) load(freshProject(), false); }}>＋ Новый проект</button>
    <button disabled={busy} onClick={() => { setMenuOpen(false); void run(async () => { setProjects(staticMode ? readLocalProjects().map(item => ({ id: item.id, name: item.name, updatedAt: item.updatedAt })) : await api('/api/projects')); }); }}>📂 Открыть проект</button>
    <button disabled={busy} onClick={() => { setMenuOpen(false); restoreInput.current?.click(); }}>⬆ Загрузить JSON</button>
    <button onClick={() => { setMenuOpen(false); if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>📘 Учебный проект</button>
  </div>;
}

/** Блок контроля данных: число замечаний и переход к проверке. */
function ProjectHealth({ issueCount, onShow }: { issueCount: number; onShow: () => void }) {
  return <div className="project-health">
    <span className="eyebrow">КОНТРОЛЬ ДАННЫХ</span>
    <strong>{issueCount ? `${issueCount} замечаний` : 'Проверка проекта'}</strong>
    <small>Неизвестные отметки, масштаб и разрывы исключают итоговый метраж.</small>
    <button onClick={onShow}>Показать проверку →</button>
  </div>;
}

/** Сайдбар: структура проекта, действия и контроль данных. */
export function Sidebar({ ui }: { ui: AppUi }) {
  const { project, tab, menuOpen, setTab, setMenuOpen, setView, issueCount, setDiagnostics, setAboutOpen } = ui;
  return (
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <SidebarTitle floors={project.floors.length} />
      <SearchBox ui={ui} />
      <StructureTabs project={project} tab={tab} onTab={setTab} />
      {tab === 'routes' && project.routes.length > 0 && <RouteSummary project={project} />}
      <MultiControls ui={ui} />
      <ObjectList ui={ui} />
      <SidebarActions ui={ui} />
      <ProjectActions ui={ui} />
      <ProjectHealth issueCount={issueCount} onShow={() => setView('specs')} />
      <div className="sidebar-about">
        <button onClick={() => { setMenuOpen(false); setDiagnostics(readDiagnostics()); setAboutOpen(true); }}>ℹ О программе / Лицензии</button>
      </div>
    </aside>
  );
}
