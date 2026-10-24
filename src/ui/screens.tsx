import { specifications } from '../engine';
import { EstimateScreen } from './estimate-screen';
import { number } from './format';
import { PlanScreen } from './plan-screen';
import { IssueList, SpecificationTables } from './specification-tables';
import type { AppUi } from './use-app-controller';

/** Переключение основных экранов приложения. */
export function MainArea({ ui }: { ui: AppUi }) {
  const { view } = ui;
  return <main className="main-area">{view === 'plan' ? <PlanScreen ui={ui} /> : view === 'journal' ? <JournalScreen ui={ui} /> : view === 'specs' ? <SpecsScreen ui={ui} /> : <EstimateScreen project={ui.project} onChange={ui.mutate} onMessage={ui.setMessage} onError={ui.setError} />}</main>;
}

/** Кабельный журнал: расчёт по кабелям проекта. */
export function JournalScreen({ ui }: { ui: AppUi }) {
  const { project, cableCalcs, selection, setSelection, totals, setView, setTool } = ui;
  return (
<section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Кабельный журнал</h1><p>Расчёт по выбранным сегментам, высотам и запасам. Единица измерения — метр.</p></div><button className="primary" onClick={() => { setView('plan'); setTool('cable'); }}>＋ Кабель</button></div><div className="table-scroll"><table><thead><tr><th>Кабель / марка</th><th>От → до</th><th>Геометрия</th><th>Запас трасс</th><th>Запас кабеля</th><th>Концы</th><th>Итог / шт.</th><th>Кол.</th><th>Стоимость, ₽</th><th>Статус</th></tr></thead><tbody>{project.cables.map(c => { const calc = cableCalcs.get(c.id)!; return <tr key={c.id} className={selection?.id === c.id ? 'selected' : ''} onClick={() => setSelection({ kind: 'cable', id: c.id })}><td><strong>{c.number}</strong><small>{c.brand || c.name}</small></td><td>{project.equipment.find(e => e.id === c.fromId)?.number || '?'} → {project.equipment.find(e => e.id === c.toId)?.number || '?'}</td><td>{number(calc.geometry)}</td><td>{number(calc.routeReserve)}</td><td>{number(calc.cableReserve)}</td><td>{number(calc.endReserve)}</td><td><strong>{number(calc.total)}</strong></td><td>{c.quantity}</td><td>{calc.cost === null ? '—' : number(calc.cost)}</td><td><span className={`badge ${calc.complete ? 'good' : 'warn'}`}>{calc.complete ? 'Рассчитан' : 'Неполный'}</span></td></tr>; })}</tbody></table>{!project.cables.length && <div className="document-empty">Создайте кабель: выберите оборудование и упорядоченную цепочку сегментов на плане.</div>}</div><div className="document-summary"><strong>{totals.metersComplete ? `${number(totals.meters)} м` : "Метраж рассчитан не полностью"}</strong><span>{totals.costComplete ? `Стоимость: ${number(totals.cost)} ₽` : "Стоимость не рассчитана: задайте цены за метр"}</span></div><div className="document-note">Итог указан для одного кабеля. Количество применяется в ведомости. Неполные значения не подменяются нулём.</div></section>
  );
}

/** Ведомости и проверка проекта. */
export function SpecsScreen({ ui }: { ui: AppUi }) {
  const { project, issues } = ui;
  return (
<section className="document-view"><div className="document-title"><div><span className="eyebrow">ДОКУМЕНТАЦИЯ</span><h1>Ведомости и проверка</h1><p>Кабельная продукция и инфраструктура. Общие сегменты инфраструктуры учитываются один раз.</p></div></div><SpecificationTables value={specifications(project)} /><h2>Замечания к проекту</h2><IssueList value={issues} /><div className="document-note">Расчёт не заменяет проверку проектировщиком. PDF может содержать разные масштабы: калибруйте каждый этаж и страницу отдельно. Совмещение осей этажей выполняется вручную.</div></section>
  );
}
