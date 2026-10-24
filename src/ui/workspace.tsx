import { PropertiesPanel } from './properties-panel';
import { MainArea } from './screens';
import { Sidebar } from './sidebar';
import type { AppUi } from './use-app-controller';

/** Рабочая область: сайдбар, основной экран и панель свойств. */
export function Workspace({ ui }: { ui: AppUi }) {
  return <div className="workspace"><Sidebar ui={ui} /><MainArea ui={ui} /><PropertiesPanel ui={ui} /></div>;
}
