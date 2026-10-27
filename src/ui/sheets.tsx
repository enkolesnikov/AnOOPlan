import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createUuid as uid } from '../compat';
import type { JournalSectionId } from '../export-pdf';
import type { ChangeEntry } from '../model';
import type { ObjectKind } from './types';
import { JOURNAL_SECTIONS } from './constants';
import { nativeBridge } from './native';
import type { AppUi } from './use-app-controller';

/** Лист регистрации изменений: строки версия/дата/автор/описание. */
const CHANGE_LABELS = { version: 'Версия', date: 'Дата', author: 'Автор', description: 'Описание' } as const;
type ChangeKey = keyof typeof CHANGE_LABELS;

export function ChangeLogEditor({ entries, onChange, onAdd, onRemove }: {
  entries: ChangeEntry[];
  onChange: (index: number, key: ChangeKey, value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return <>
    <span className="section-label">Лист регистрации изменений <span>{entries.length}</span></span>
    <div className="change-list">{entries.map((entry, index) => <div className="change-row" key={entry.id}>{(Object.keys(CHANGE_LABELS) as ChangeKey[]).map(key => <input key={key} type="text" aria-label={`${CHANGE_LABELS[key]} изменения ${index + 1}`} placeholder={CHANGE_LABELS[key]} value={entry[key] || ''} onChange={event => onChange(index, key, event.target.value)} />)}<button className="change-remove" aria-label={`Удалить изменение ${index + 1}`} onClick={() => onRemove(entry.id)}>×</button></div>)}</div>
    <button className="change-add" onClick={onAdd}>＋ Изменение</button>
  </>;
}

/** Разделы шторки «Экспорт и копия»: три разные задачи вместо одного длинного списка. */
const EXPORT_TABS = [
  { id: 'files', label: 'Файлы' },
  { id: 'print', label: 'Печать' },
  { id: 'document', label: 'Реквизиты' },
] as const;
type ExportTab = (typeof EXPORT_TABS)[number]['id'];

/** Быстрые форматы: подпись и понятный состав результата. */
const EXPORT_FORMATS: { format: 'pdf' | 'xlsx' | 'csv' | 'backup'; label: string; hint: string }[] = [
  { format: 'pdf', label: 'PDF', hint: 'Комплект печатных документов' },
  { format: 'xlsx', label: 'XLSX', hint: 'Книга Excel: журнал, ведомости, смета' },
  { format: 'csv', label: 'CSV', hint: 'Журнал и ведомости таблицей' },
  { format: 'backup', label: 'JSON', hint: 'Проект и исходные PDF' },
];
/** «Короткий комплект» печати — основные листы для быстрой выдачи. */
const SHORT_PRINT_SET: JournalSectionId[] = ['journal', 'equipment', 'cables', 'estimate'];

/** Шторка «Экспорт и копия»: вкладки «Файлы», «Печать» и «Реквизиты». */
export function ExportSheet({ ui }: { ui: AppUi }) {
  const {
    project, busy, run, download, printSections, setPrintSections, togglePrintSection, printJournal, setExportOpen,
    shareExport, shareAnoPlan, saveAnoPlan, openHistory, restoreInput, mutate,
  } = ui;
  const [tab, setTab] = useState<ExportTab>('files');
  const shareAvailable = typeof nativeBridge()?.shareFile === 'function';
  function documentField(label: string, key: 'organization' | 'object' | 'documentCode' | 'city' | 'title') {
    return <label className="field">{label}<input type="text" value={project.document?.[key] || ''} onChange={event => mutate(p => { p.document = { ...p.document, [key]: event.target.value }; })} /></label>;
  }
  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = EXPORT_TABS.findIndex(item => item.id === tab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % EXPORT_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + EXPORT_TABS.length) % EXPORT_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = EXPORT_TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setTab(EXPORT_TABS[next].id);
    document.getElementById(`export-tab-${EXPORT_TABS[next].id}`)?.focus();
  }
  return (
<div className="sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setExportOpen(false); }}><section className="sheet export-sheet" role="dialog" aria-label="Экспорт и копия">
      <div className="sheet-grip" />
      <div className="sheet-head"><strong>Экспорт и копия</strong><button aria-label="Закрыть" onClick={() => setExportOpen(false)}>×</button></div>
      <div className="export-tabs" role="tablist" aria-label="Разделы экспорта">
        {EXPORT_TABS.map(item => <button key={item.id} type="button" role="tab" id={`export-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`export-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={onTabKeyDown}>{item.label}</button>)}
      </div>
      <div className="sheet-list export-panels">
        <div className="export-panel" id="export-panel-files" role="tabpanel" aria-labelledby="export-tab-files" hidden={tab !== 'files'}>
          <div className="export-formats">{EXPORT_FORMATS.map(({ format, label, hint }) => <div className="export-format" key={format}><button disabled={busy} aria-describedby={`export-format-hint-${format}`} onClick={() => { setExportOpen(false); void run(() => download(format)); }}>{label}</button><small id={`export-format-hint-${format}`}>{hint}</small></div>)}</div>
          {shareAvailable && <><span className="section-label">Поделиться</span><div className="export-row"><button className="share-pdf" disabled={busy} onClick={() => void run(() => shareExport('pdf'))}>Поделиться PDF</button><button className="share-xlsx" disabled={busy} onClick={() => void run(() => shareExport('xlsx'))}>Поделиться XLSX</button><button className="share-anooplan" disabled={busy} onClick={() => void run(() => shareAnoPlan())}>Поделиться .anooplan</button></div></>}
          <span className="section-label">Резервная копия и история</span>
          <button className="anooplan-save" disabled={busy} onClick={() => void run(() => saveAnoPlan())}>Сохранить проект .anooplan</button>
          <p className="help">.anooplan — полный проект с PDF-планами и фотографиями. JSON — проект и исходные PDF.</p>
          <div className="export-row"><button onClick={() => { setExportOpen(false); void openHistory(); }}>История версий</button><button onClick={() => { setExportOpen(false); restoreInput.current?.click(); }}>Восстановить JSON…</button></div>
        </div>
        <div className="export-panel" id="export-panel-print" role="tabpanel" aria-labelledby="export-tab-print" hidden={tab !== 'print'}>
          <span className="section-label">Печать: выбранные разделы <span className="print-sections-count">{printSections.length} из {JOURNAL_SECTIONS.length}</span></span>
          <div className="print-presets"><button type="button" onClick={() => setPrintSections(JOURNAL_SECTIONS.map(section => section.id))}>Выбрать все</button><button type="button" onClick={() => setPrintSections([])}>Снять выбор</button><button type="button" onClick={() => setPrintSections(SHORT_PRINT_SET)}>Короткий комплект</button></div>
          <div className="print-sections">{JOURNAL_SECTIONS.map(section => <label key={section.id} className="print-section"><input type="checkbox" className="section-checkbox" checked={printSections.includes(section.id)} onChange={() => togglePrintSection(section.id)} />{section.label}</label>)}</div>
          <button className="print-selected" disabled={busy} onClick={() => { setExportOpen(false); void run(() => printJournal()); }}>Печать выбранных разделов</button>
          <p className="help">Печать откроется в мобильном приложении системным диалогом. Отметьте хотя бы один раздел — пустой выбор ничего не печатает.</p>
        </div>
        <div className="export-panel" id="export-panel-document" role="tabpanel" aria-labelledby="export-tab-document" hidden={tab !== 'document'}>
          <span className="section-label">Титульный лист</span>
          <div className="document-fields">{documentField('Организация', 'organization')}{documentField('Объект', 'object')}{documentField('Шифр документа', 'documentCode')}{documentField('Город', 'city')}{documentField('Заголовок документа', 'title')}</div>
          <ChangeLogEditor
            entries={project.document?.changeLog ?? []}
            onChange={(index, key, value) => mutate(p => { const list = [...(p.document?.changeLog ?? [])]; if (!list[index]) return; list[index] = { ...list[index], [key]: value }; p.document = { ...p.document, changeLog: list }; })}
            onAdd={() => mutate(p => { p.document = { ...p.document, changeLog: [...(p.document?.changeLog ?? []), { id: uid(), version: '', date: '', author: '', description: '' }] }; })}
            onRemove={id => mutate(p => { p.document = { ...p.document, changeLog: (p.document?.changeLog ?? []).filter(entry => entry.id !== id) }; })}
          />
          <div className="sheet-fields"><label className="field">Составил<input type="text" value={project.document?.compiledBy || ''} onChange={e => mutate(p => { p.document = { ...p.document, compiledBy: e.target.value }; })} /></label><label className="field">Проверил<input type="text" value={project.document?.checkedBy || ''} onChange={e => mutate(p => { p.document = { ...p.document, checkedBy: e.target.value }; })} /></label></div>
        </div>
      </div>
    </section></div>
  );
}

/** Шторка «История версий»: снимки проекта в IndexedDB. */
export function HistorySheet({ ui }: { ui: AppUi }) {
  const { setHistoryOpen, takeSnapshot, openHistory, setError, snapshots, restoreSnapshot, deleteSnapshot } = ui;
  return (
<div className="sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><section className="sheet" role="dialog" aria-label="История версий"><div className="sheet-grip" /><div className="sheet-head"><strong>История версий</strong><button aria-label="Закрыть" onClick={() => setHistoryOpen(false)}>×</button></div><div className="sheet-list"><button onClick={() => void takeSnapshot('вручную').then(() => openHistory()).catch(() => setError('Не удалось сделать снимок: хранилище недоступно.'))}>＋ Сделать снимок сейчас</button>{snapshots === null ? <p className="help">Загружаю…</p> : snapshots.length ? snapshots.map(entry => <div className="snapshot-row" key={entry.key}><button className="snapshot-open" onClick={() => void restoreSnapshot(entry.key)}><strong>{new Date(entry.createdAt).toLocaleString('ru-RU')}</strong><small>{entry.reason} · {entry.project.equipment.length} оборуд. · {entry.project.cables.length} кабелей</small></button><button className="snapshot-delete" aria-label="Удалить снимок" onClick={() => void deleteSnapshot(entry.key)}>🗑</button></div>) : <p className="help">Снимков пока нет. Они создаются автоматически раз в 5 минут при изменениях и при ручном сохранении.</p>}</div></section></div>
  );
}

/** Шторка действий с объектом: свойства, копия, удаление. */
export function ObjectActionSheet({ ui }: { ui: AppUi }) {
  const { setSheet, setPropsOpen, project, copyObject, removeObject } = ui;
  const sheet = ui.sheet!;
  function sheetTitle(value: { kind: ObjectKind; id: string }) {
    const label = value.kind === 'equipment' ? 'Оборудование' : value.kind === 'route' ? 'Трасса' : value.kind === 'pin' ? 'Замечание' : 'Кабель';
    const item = value.kind === 'equipment' ? project.equipment.find(e => e.id === value.id) : value.kind === 'route' ? project.routes.find(r => r.id === value.id) : value.kind === 'pin' ? project.pins.find(pin => pin.id === value.id) : project.cables.find(c => c.id === value.id);
    return item ? `${label} ${item.number}` : label;
  }
  return (
<div className="sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setSheet(null); }}><section className="sheet" role="dialog" aria-label="Действия с объектом"><div className="sheet-grip" /><div className="sheet-head"><strong>{sheetTitle(sheet)}</strong><button aria-label="Закрыть" onClick={() => setSheet(null)}>×</button></div><div className="sheet-list"><button onClick={() => { setPropsOpen(true); setSheet(null); }}>⚙ Свойства</button><button onClick={() => { copyObject(sheet.kind, sheet.id); setSheet(null); }}>⧉ Копировать</button><button className="danger" onClick={() => removeObject(sheet.kind, sheet.id)}>🗑 Удалить</button></div></section></div>
  );
}
