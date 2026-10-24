import { createDemoProject } from '../demo';
import { readDiagnostics } from '../diagnostics';
import { readLocalProjects } from '../local-projects';
import { api } from './api';
import { EquipmentIcon } from './equipment-icon';
import { number } from './format';
import { routeColor, routeKindOf } from '../route-kinds';
import { routeAngleStats, routeLength, routeSummary } from '../engine';
import { freshFloor, freshProject } from './project-factory';
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
  return <button data-kind="equipment" data-id={item.id} className={`object-row ${selection?.id === item.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'equipment', id: item.id }); setFloorId(item.floorId); setView('plan'); setMenuOpen(false); }}>
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
  return <button data-kind="route" data-id={item.id} className={`object-row ${selection?.id === item.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'route', id: item.id }); if (item.segments[0]) setFloorId(item.segments[0].a.floorId); setView('plan'); setMenuOpen(false); }}>
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
  return <button data-kind="pin" data-id={item.id} className={`object-row ${selection?.id === item.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'pin', id: item.id }); setFloorId(item.floorId); setView('plan'); setMenuOpen(false); }}>
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
  return <button data-kind="cable" data-id={item.id} className={`object-row ${selection?.id === item.id ? 'selected' : ''}`} onClick={() => { setSelection({ kind: 'cable', id: item.id }); setMenuOpen(false); }}>
    <span className="object-icon cable-icon">↝</span>
    <span>
      <strong>{item.number} · {item.brand || item.name}</strong>
      <small>{calc.complete ? `${number(calc.total)} м` : 'Неполный расчёт'}</small>
    </span>
    <i className={calc.complete ? 'dot calibrated' : 'dot warning'} />
  </button>;
}

/** Список объектов активной вкладки (этажи/оборудование/трассы/кабели/замечания). */
function ObjectList({ ui }: { ui: AppUi }) {
  const { tab, project, listPressDown, moveLongPress, cancelLongPress } = ui;
  return <div className="object-list" onPointerDown={listPressDown} onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}>
    {tab === 'floors' ? project.floors.map((item, index) => <FloorRow key={item.id} ui={ui} floor={item} index={index} />)
      : tab === 'equipment' ? project.equipment.map(item => <EquipmentRow key={item.id} ui={ui} item={item} />)
        : tab === 'routes' ? project.routes.map(item => <RouteRow key={item.id} ui={ui} item={item} />)
          : tab === 'pins' ? project.pins.map(item => <PinRow key={item.id} ui={ui} item={item} />)
            : project.cables.map(item => <CableRow key={item.id} ui={ui} item={item} />)}
    {project[tab].length === 0 && <div className="empty-list">Объектов пока нет.<br />Добавьте их на плане.</div>}
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
      <StructureTabs project={project} tab={tab} onTab={setTab} />
      {tab === 'routes' && project.routes.length > 0 && <RouteSummary project={project} />}
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
