import { createDemoProject } from '../demo';
import { readLocalProjects } from '../local-projects';
import type { Project } from '../model';
import { api } from './api';
import { freshProject } from './project-factory';
import type { AppUi } from './use-app-controller';

/** Верхняя панель: название проекта, сохранение и загрузка файлов. */
export function Topbar({ ui }: { ui: AppUi }) {
  const { menuOpen, setMenuOpen, project, mutate, dirty, busy, load, run, setProjects, staticMode, restoreInput, saveProject, persisted, mayLeave } = ui;
  return (
    <header className="topbar"><button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen(v => !v)}>☰</button><div className="brand"><span className="brand-mark">A</span><div>AnOOPlan<small>кабельный план</small></div></div><div className="project-heading"><input aria-label="Название проекта" value={project.name} onChange={e => mutate(p => { p.name = e.target.value; })} /><span className={dirty ? 'save-indicator dirty' : 'save-indicator'}>{dirty ? '● Не сохранён' : '● Сохранён'}</span></div><div className="top-actions"><button className="desk-only" onClick={() => { if (mayLeave()) load(freshProject(), false); }}>Новый</button><button className="desk-only" disabled={busy} onClick={() => void run(async () => { setProjects(staticMode ? readLocalProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); })}>Открыть</button><button disabled={busy} title="Загрузить ранее экспортированный JSON-проект" onClick={() => restoreInput.current?.click()}>Загрузить</button><button className="primary" disabled={busy || (persisted && !dirty)} onClick={() => void run(async () => { await saveProject(); })}>{busy ? 'Подождите…' : persisted && !dirty ? 'Сохранено ✓' : 'Сохранить'}</button></div></header>
  );
}

/** Панель команд: вкладки экранов, учебный проект и экспорт. */
export function CommandBar({ ui }: { ui: AppUi }) {
  const { view, setView, mayLeave, load, setMessage, setExportOpen } = ui;
  return (
    <div className="commandbar"><div className="view-tabs">{([['plan', 'План'], ['journal', 'Журнал'], ['specs', 'Ведомости'], ['estimate', 'Смета']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><div className="command-actions"><button className="desk-only" onClick={() => { if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>Учебный проект</button><button className="export-trigger" onClick={() => setExportOpen(true)}>Экспорт / копия ↓</button></div></div>
  );
}

/** Статусная строка: сообщения и счётчики проекта. */
export function Footer({ ui }: { ui: AppUi }) {
  const { message, project, staticMode } = ui;
  return (
<footer className="statusbar"><span role="status" aria-live="polite"><i className="dot calibrated" />{message}</span><span>{project.equipment.length} оборуд. · {project.routes.length} трасс · {project.cables.length} кабелей <b>{staticMode ? 'БРАУЗЕР' : 'СЕРВЕР'}</b></span></footer>
  );
}

/** Затемнение под открытыми панелями: кнопка, чтобы панели закрывались и с клавиатуры. */
export function Scrim({ ui }: { ui: AppUi }) {
  const { menuOpen, propsOpen, setMenuOpen, setPropsOpen } = ui;
  return (
<button type="button" className="scrim" aria-label="Закрыть панели" onClick={() => { setMenuOpen(false); setPropsOpen(false); }} />
  );
}

/** Плавающая кнопка свойств. */
export function PropsFab({ ui }: { ui: AppUi }) {
  const { propsOpen, setPropsOpen } = ui;
  return (
    <button className={`props-fab ${propsOpen ? 'active' : ''}`} aria-label="Свойства" onClick={() => setPropsOpen(v => !v)}>⚙</button>
  );
}

/** Плавающие кнопки отмены и повтора. */
export function HistoryFab({ ui }: { ui: AppUi }) {
  const { undo, redo, history, undoLabel, redoLabel } = ui;
  return (
    <div className="history-fab">
      <button title={undoLabel ? `Отменить: ${undoLabel} (Ctrl+Z)` : 'Отменить Ctrl+Z'} aria-label="Отменить" disabled={!undo.length} onClick={() => history(true)}>↶</button>
      <button title={redoLabel ? `Повторить: ${redoLabel} (Ctrl+Shift+Z)` : 'Повторить Ctrl+Shift+Z'} aria-label="Повторить" disabled={!redo.length} onClick={() => history(false)}>↷</button>
    </div>
  );
}

/** Скрытые input'ы для фото, PDF и JSON-файлов. */
export function HiddenInputs({ ui }: { ui: AppUi }) {
  const { photoInput, cameraInput, upload, restoreInput, run, addPhoto, uploadPdf, mayLeave, restoreProjectFile } = ui;
  return (
<>
    <input hidden ref={photoInput} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => addPhoto(file)); e.target.value = ''; }} />
    <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => addPhoto(file)); e.target.value = ''; }} />
    <input hidden ref={upload} type="file" accept="application/pdf,.pdf" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => uploadPdf(file)); e.target.value = ''; }} />
    <input hidden ref={restoreInput} type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file && mayLeave()) void run(() => restoreProjectFile(file)); e.target.value = ''; }} />
</>
  );
}

/** Модальный список сохранённых проектов. */
export function ProjectsModal({ ui }: { ui: AppUi }) {
  const { setProjects, busy, mayLeave, run, staticMode, load, setMessage, deleteProject } = ui;
  const projects = ui.projects!;
  return (
<div className="modal-backdrop"><section className="modal"><div className="modal-heading"><h2>Открыть проект</h2><button onClick={() => setProjects(null)}>×</button></div>{projects.length ? projects.map(p => <div className="project-row" key={p.id}><button className="project-option" disabled={busy} onClick={() => { if (mayLeave()) void run(async () => { const result = staticMode ? readLocalProjects().find(x => x.id === p.id)! : await api<Project>(`/api/projects/${p.id}`); load(result, true); setProjects(null); setMessage(`Проект «${result.name}» открыт.`); }); }}><strong>{p.name}</strong><small>{new Date(p.updatedAt).toLocaleString('ru-RU')}</small><span>→</span></button><button className="project-delete" disabled={busy} title="Удалить проект" onClick={() => void run(() => deleteProject(p.id, p.name))}>🗑</button></div>) : <p className="help">Сохранённых проектов пока нет.</p>}</section></div>
  );
}
