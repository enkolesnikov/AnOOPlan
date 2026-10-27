import { useState } from 'react';
import { createDemoProject } from '../demo';
import { readLocalProjects } from '../local-projects';
import type { Project } from '../model';
import { api } from './api';
import { builtInTemplates, deleteCustomTemplate, instantiateTemplate, readCustomTemplates, saveCustomTemplate, type ProjectTemplate } from '../templates';
import type { AppUi } from './use-app-controller';

/** Верхняя панель: название проекта, сохранение и загрузка файлов. */
export function Topbar({ ui }: { ui: AppUi }) {
  const { menuOpen, setMenuOpen, project, mutate, dirty, busy, load, run, setProjects, staticMode, restoreInput, saveProject, persisted, mayLeave, setTemplatesOpen } = ui;
  return (
    <header className="topbar"><button className="menu-toggle" aria-label="Меню" onClick={() => setMenuOpen(v => !v)}>☰</button><div className="brand"><span className="brand-mark">A</span><div>AnOOPlan<small>кабельный план</small></div></div><div className="project-heading"><input aria-label="Название проекта" value={project.name} onChange={e => mutate(p => { p.name = e.target.value; })} /><span className={dirty ? 'save-indicator dirty' : 'save-indicator'}>{dirty ? '● Не сохранён' : '● Сохранён'}</span></div><div className="top-actions"><button className="desk-only" onClick={() => setTemplatesOpen(true)}>Новый</button><button className="desk-only" disabled={busy} onClick={() => void run(async () => { setProjects(staticMode ? readLocalProjects().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })) : await api('/api/projects')); })}>Открыть</button><button disabled={busy} title="Загрузить ранее экспортированный JSON-проект" onClick={() => restoreInput.current?.click()}>Загрузить</button><button className="primary" disabled={busy || (persisted && !dirty)} onClick={() => void run(async () => { await saveProject(); })}>{busy ? 'Подождите…' : persisted && !dirty ? 'Сохранено ✓' : 'Сохранить'}</button></div></header>
  );
}

/** Панель команд: вкладки экранов, учебный проект и экспорт. */
export function CommandBar({ ui }: { ui: AppUi }) {
  const { view, setView, mayLeave, load, setMessage, setExportOpen } = ui;
  return (
    <div className="commandbar"><div className="view-tabs">{([['plan', 'План'], ['journal', 'Журнал'], ['specs', 'Ведомости'], ['estimate', 'Смета']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}</div><div className="command-actions"><button className="desk-only" onClick={() => { if (mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); } }}>Учебный проект</button><button className="export-trigger" onClick={() => setExportOpen(true)}>Экспорт / копия ↓</button></div></div>
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
  const { undo, redo, history, undoLabel, redoLabel, propsOpen, menuOpen, exportOpen, historyOpen, aboutOpen, templatesOpen, onboardingOpen, sheet } = ui;
  if (propsOpen || menuOpen || exportOpen || historyOpen || aboutOpen || templatesOpen || onboardingOpen || sheet) return null;
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

/** Модалка «Новый проект»: встроенные и сохранённые шаблоны. */
export function TemplatesModal({ ui }: { ui: AppUi }) {
  const { setTemplatesOpen, mayLeave, load, setMessage, project } = ui;
  const [templates, setTemplates] = useState<ProjectTemplate[]>(() => [...builtInTemplates(), ...readCustomTemplates()]);
  function open(template: ProjectTemplate): void {
    if (!mayLeave()) return;
    load(instantiateTemplate(template), false);
    setTemplatesOpen(false);
    setMessage(`Проект создан из шаблона «${template.name}».`);
  }
  function saveCurrent(): void {
    const name = window.prompt('Название шаблона', project.name);
    if (!name?.trim()) return;
    try {
      saveCustomTemplate(project, name.trim());
      setTemplates([...builtInTemplates(), ...readCustomTemplates()]);
      setMessage(`Шаблон «${name.trim()}» сохранён.`);
    } catch (error) {
      setMessage(`Не удалось сохранить шаблон: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function remove(template: ProjectTemplate): void {
    if (!window.confirm(`Удалить шаблон «${template.name}»?`)) return;
    deleteCustomTemplate(template.id);
    setTemplates([...builtInTemplates(), ...readCustomTemplates()]);
    setMessage(`Шаблон «${template.name}» удалён.`);
  }
  return <div className="modal-backdrop"><section className="modal template-modal">
    <div className="modal-heading"><h2>Новый проект</h2><button aria-label="Закрыть" onClick={() => setTemplatesOpen(false)}>×</button></div>
    <p className="help">Выберите шаблон — этажи, оборудование и трассы появятся сразу. PDF-подложку добавьте после.</p>
    <div className="template-grid">
      {templates.map(template => <div className={`template-card ${template.builtIn ? '' : 'custom'}`} key={template.id}>
        <button className="template-option" onClick={() => open(template)}>
          <strong>{template.name}</strong>
          <small>{template.description}</small>
          <span>{template.project.floors.length} эт. · {template.project.equipment.length} оборуд. · {template.project.routes.length} трасс</span>
        </button>
        {!template.builtIn && <button className="template-delete" title="Удалить шаблон" aria-label={`Удалить шаблон ${template.name}`} onClick={() => remove(template)}>🗑</button>}
      </div>)}
    </div>
    <div className="template-actions"><button type="button" onClick={saveCurrent}>＋ Сохранить текущий как шаблон</button></div>
  </section></div>;
}

const ONBOARDING_STEPS = [
  { title: 'Подложка PDF', text: 'Загрузите план этажа в PDF — он станет фоном чертежа. Кнопка «Загрузить PDF» на вкладке «Этажи».' },
  { title: 'Калибровка', text: 'Укажите две точки известного размера и введите расстояние в метрах — масштаб плана будет точным.' },
  { title: 'Оборудование', text: 'Инструмент «Оборудование» ставит камеры, шкафы и розетки. Готовые наборы — «Комплект» на вкладке оборудования.' },
  { title: 'Трассы и кабели', text: 'Начертите трассу или выберите два устройства инструментом «Кабель» — маршрут построится сам.' },
  { title: 'Документы', text: 'Журнал, ведомости, смета и PDF собираются из данных проекта. Начните с учебного проекта, чтобы посмотреть весь путь.' },
];

/** Пятишаговое обучение на демо-проекте; без сетевых ассетов. */
export function Onboarding({ ui }: { ui: AppUi }) {
  const { setOnboardingOpen, load, setMessage, mayLeave } = ui;
  const [step, setStep] = useState(0);
  const last = step === ONBOARDING_STEPS.length - 1;
  function finish(openDemo: boolean): void {
    try { localStorage.setItem('cableplan:onboarded', '1'); } catch { /* приватный режим */ }
    setOnboardingOpen(false);
    if (openDemo && mayLeave()) { load(createDemoProject(), false); setMessage('Учебный проект: синтетические данные, не рабочая документация.'); }
  }
  const current = ONBOARDING_STEPS[step];
  return <div className="modal-backdrop"><section className="modal onboarding-modal">
    <div className="modal-heading"><h2>Как устроен AnOOPlan</h2><button aria-label="Закрыть обучение" onClick={() => finish(false)}>×</button></div>
    <div className="onboarding-progress" aria-label={`Шаг ${step + 1} из ${ONBOARDING_STEPS.length}`}>{ONBOARDING_STEPS.map((item, index) => <i key={item.title} className={index <= step ? 'done' : ''} />)}</div>
    <span className="eyebrow">ШАГ {step + 1} ИЗ {ONBOARDING_STEPS.length}</span>
    <h3>{current.title}</h3>
    <p>{current.text}</p>
    <div className="onboarding-actions">
      <button type="button" onClick={() => finish(false)}>Пропустить</button>
      {step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Назад</button>}
      {last
        ? <button type="button" className="primary" onClick={() => finish(true)}>Открыть учебный проект</button>
        : <button type="button" className="primary" onClick={() => setStep(step + 1)}>Далее →</button>}
    </div>
  </section></div>;
}

/** Модальный список сохранённых проектов. */
export function ProjectsModal({ ui }: { ui: AppUi }) {
  const { setProjects, busy, mayLeave, run, staticMode, load, setMessage, deleteProject } = ui;
  const projects = ui.projects!;
  return (
<div className="modal-backdrop"><section className="modal"><div className="modal-heading"><h2>Открыть проект</h2><button onClick={() => setProjects(null)}>×</button></div>{projects.length ? projects.map(p => <div className="project-row" key={p.id}><button className="project-option" disabled={busy} onClick={() => { if (mayLeave()) void run(async () => { const result = staticMode ? readLocalProjects().find(x => x.id === p.id)! : await api<Project>(`/api/projects/${p.id}`); load(result, true); setProjects(null); setMessage(`Проект «${result.name}» открыт.`); }); }}><strong>{p.name}</strong><small>{new Date(p.updatedAt).toLocaleString('ru-RU')}</small><span>→</span></button><button className="project-delete" disabled={busy} title="Удалить проект" onClick={() => void run(() => deleteProject(p.id, p.name))}>🗑</button></div>) : <p className="help">Сохранённых проектов пока нет.</p>}</section></div>
  );
}
