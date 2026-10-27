import { PropertiesPanel } from './properties-panel';
import { MainArea } from './screens';
import { Sidebar } from './sidebar';
import type { AppUi } from './use-app-controller';

/**
 * Рабочая область: сайдбар, основной экран и панель свойств.
 *
 * Документные виды (журнал, ведомости, смета) используют всю ширину: свойства
 * там занимают место только по явному запросу пользователя. На плане панель
 * остаётся частью рабочего места, как и раньше.
 */
export function Workspace({ ui }: { ui: AppUi }) {
  const { view, propsOpen, setPropsOpen } = ui;
  const documentView = view !== 'plan';
  return <div className="workspace">
    <Sidebar ui={ui} />
    <MainArea ui={ui} />
    {(!documentView || propsOpen) && <PropertiesPanel ui={ui} />}
    {documentView && <button
      type="button"
      className={`props-toggle-doc ${propsOpen ? 'active' : ''}`}
      aria-pressed={propsOpen}
      onClick={() => setPropsOpen(value => !value)}
    >⚙ {propsOpen ? 'Скрыть свойства' : 'Свойства'}</button>}
  </div>;
}
