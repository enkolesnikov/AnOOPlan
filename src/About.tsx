import oflText from './assets/fonts/OFL.txt?raw';
import packageInfo from '../package.json';
import type { DiagnosticEntry } from './diagnostics';

export const APP_VERSION = packageInfo.version;

const COMPONENTS = [
  ['React, React DOM', 'MIT'],
  ['pdf-lib, @pdf-lib/fontkit', 'MIT'],
  ['PDF.js (pdfjs-dist)', 'Apache-2.0'],
  ['SheetJS (xlsx)', 'Apache-2.0'],
  ['Vite, TypeScript, esbuild', 'MIT'],
  ['Express (серверная версия)', 'MIT'],
  ['PT Sans — сабсет AnOOPlan Sans', 'SIL Open Font License 1.1'],
];

export function AboutSheet({ onClose, diagnostics, onExportDiagnostics, onClearDiagnostics }: {
  onClose: () => void;
  diagnostics: DiagnosticEntry[];
  onExportDiagnostics: () => void;
  onClearDiagnostics: () => void;
}) {
  return (
    <div className="sheet-backdrop about-backdrop" onClick={onClose}>
      <section className="sheet about-sheet" role="dialog" aria-label="О программе и лицензии" onClick={event => event.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <strong>О программе / Лицензии</strong>
          <button aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        <div className="about-body">
          <div className="about-title">
            <span className="brand-mark">A</span>
            <div><strong>AnOOPlan</strong><small>кабельный план · версия {APP_VERSION}</small></div>
          </div>
          <p>Приложение для раскладки кабельных трасс по PDF-планам и расчёта кабельного журнала. Работает офлайн: проекты, планы и фотографии хранятся на устройстве.</p>
          <p className="about-copy">© 2026 enkolesnikov. Исходный код распространяется по лицензии MIT.</p>

          <h3>Диагностика</h3>
          <p className="about-help">Локальный журнал ошибок (до 50 записей) хранится только на устройстве. Если PDF не отрисовался или что-то пошло не так — скачайте журнал и пришлите разработчику.</p>
          <div className="diagnostics-actions">
            <button onClick={onExportDiagnostics}>Скачать журнал</button>
            <button onClick={onClearDiagnostics} disabled={!diagnostics.length}>Очистить</button>
          </div>
          {diagnostics.length
            ? <pre className="diagnostics-log">{diagnostics.slice(-5).map(entry => `${entry.at} [${entry.kind}]${entry.context ? ` (${entry.context})` : ''}\n${entry.message}`).join('\n\n')}</pre>
            : <p className="about-help">Ошибок не зафиксировано.</p>}

          <h3>PT Sans (сабсет AnOOPlan Sans)</h3>
          <p>Для PDF встроены сабсеты шрифтов PT Sans Regular и PT Sans Bold: только латиница, кириллица, цифры и типографские символы. Сабсет уменьшает размер приложения; по требованию OFL модифицированные шрифты переименованы в «AnOOPlan Sans» и не используют зарезервированные имена. Лицензия — SIL Open Font License 1.1, полный текст приведён ниже.</p>
          <pre className="license-text">{oflText}</pre>

          <h3>Компоненты с открытым кодом</h3>
          <ul className="component-list">
            {COMPONENTS.map(([name, license]) => <li key={name}><span>{name}</span><i>{license}</i></li>)}
          </ul>
          <p className="about-help">Полные тексты лицензий компонентов входят в исходный репозиторий проекта.</p>
        </div>
      </section>
    </div>
  );
}
