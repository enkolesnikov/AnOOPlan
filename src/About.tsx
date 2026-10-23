import oflText from './assets/fonts/OFL.txt?raw';
import packageInfo from '../package.json';

const COMPONENTS = [
  ['React, React DOM', 'MIT'],
  ['pdf-lib, @pdf-lib/fontkit', 'MIT'],
  ['PDF.js (pdfjs-dist)', 'Apache-2.0'],
  ['SheetJS (xlsx)', 'Apache-2.0'],
  ['Vite, TypeScript, esbuild', 'MIT'],
  ['Express, pdfkit (серверная версия)', 'MIT'],
  ['PT Sans', 'SIL Open Font License 1.1'],
];

export function AboutSheet({ onClose }: { onClose: () => void }) {
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
            <div><strong>AnOOPlan</strong><small>кабельный план · версия {packageInfo.version}</small></div>
          </div>
          <p>Приложение для раскладки кабельных трасс по PDF-планам и расчёта кабельного журнала. Работает офлайн: проекты, планы и фотографии хранятся на устройстве.</p>
          <p className="about-copy">© 2026 enkolesnikov. Исходный код распространяется по лицензии MIT.</p>

          <h3>PT Sans</h3>
          <p>В приложение встроены шрифты PT Sans Regular и PT Sans Bold. Они используются для кириллицы в PDF и распространяются по SIL Open Font License 1.1. Полный текст лицензии приведён ниже, как требует OFL.</p>
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
