import { AboutSheet } from './About';
import { clearDiagnostics } from './diagnostics';
import { CommandBar, Footer, HiddenInputs, HistoryFab, Onboarding, PropsFab, ProjectsModal, Scrim, TemplatesModal, Topbar } from './ui/chrome';
import { ExportSheet, HistorySheet, ObjectActionSheet } from './ui/sheets';
import { useAppController } from './ui/use-app-controller';
import { Workspace } from './ui/workspace';

/**
 * Точка входа приложения: собирает каркас интерфейса из экранов и панелей.
 * Всё состояние, действия и эффекты живут в useAppController.
 */
export default function App() {
  const ui = useAppController();
  return <div className="app-shell">
    <Topbar ui={ui} />
    <CommandBar ui={ui} />
    {ui.error && <div className="banner error" role="alert"><strong>Не удалось выполнить действие.</strong> {ui.error}<button onClick={() => ui.setError('')}>×</button></div>}
    <Workspace ui={ui} />
    <Footer ui={ui} />
    {ui.aboutOpen && <AboutSheet
      onClose={() => ui.setAboutOpen(false)}
      diagnostics={ui.diagnostics}
      onExportDiagnostics={() => void ui.run(ui.exportDiagnostics)}
      onClearDiagnostics={() => { clearDiagnostics(); ui.setDiagnostics([]); }}
    />}
    {(ui.menuOpen || ui.propsOpen) && <Scrim ui={ui} />}
    <PropsFab ui={ui} />
    <HistoryFab ui={ui} />
    {ui.exportOpen && <ExportSheet ui={ui} />}
    {ui.historyOpen && <HistorySheet ui={ui} />}
    {ui.sheet && <ObjectActionSheet ui={ui} />}
    <HiddenInputs ui={ui} />
    {ui.projects && <ProjectsModal ui={ui} />}
    {ui.templatesOpen && <TemplatesModal ui={ui} />}
    {ui.onboardingOpen && <Onboarding ui={ui} />}
  </div>;
}
