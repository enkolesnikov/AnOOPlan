# AnOOPlan — ревью и рекомендации (kimi-k3.1-pro, 2026-10-27)

Ревью проведено по репозиторию `/root/Anooplan` на коммите `755504c` (`2.8.0`, `versionCode 39`).
Код проекта **не изменялся** — единственный созданный файл это этот отчёт. Все команды проверки
приведены в [приложении](#приложение-как-проверялось) и воспроизводимы.


---

## 0. Статус проверки и исправлений (2026-10-28)

Отчёт проверен по коду; подтверждённые пункты исправлены в **2.8.1**. Что важно знать при чтении:

**Исправлено в 2.8.1:** покрытие теперь печатает вторую цифру по всему `src/` (60,8 % на момент
патча, а не 57,8 % — добавились тесты); IndexedDB переиспользует соединение и закрывает его по
`versionchange`; `dirty` не сериализует проект на каждый рендер; растр плана считается от 150 dpi
(A4 ≈1754, A0 ≈2380 px, два canvas ≤8 Мпикс); добавлена CSP, ES5-страж вынесен во внешний файл,
ACAO `*` из AssetServer убран; `normalizeSegment` отбрасывает не-объекты; XLSX/CSV ограничен
8 МБ/5000 строк; потеря вложений `.anooplan` и переполнение localStorage показываются; `build-apk.sh`
делает `tsc --noEmit`; Pages переведён на Node 24; `key` в «Дополнительных свойствах» исправлен,
смоук падает на React-предупреждениях; README-версия и цифры приведены к факту; `.gitignore`
закрывает рабочие материалы.

**Не подтвердилось:** утверждение, что `tests/release-config.test.ts` фиксирует «2 E2E» — в файле
нет проверок E2E. Смоук до патча давал 233 проверки; после добавления контроля React-предупреждений
их 234. Цифра 57,8 % была верна на коммите аудита, после исправлений и новых тестов — 60,8 %.

**Отложено (осознанно):** квота `navigator.storage()` и баннер хранилища; полный распил
`AppUi`/`export-pdf.ts`/`MainActivity`; управляемый с клавиатуры план; `buildModel` и суммарный
бюджет чанков; golden fixtures схемы. Эти пункты требуют отдельного релиза и не входят в 2.8.1.

Актуальные числа 2.8.1: 277 тестов, 234 смоука, 4 E2E, покрытие 95,1/87,5/94,8 % (тестируемые
модули) и 60,8 % по всем `src/`; APK 1 600 200 Б, versionCode 40.

---

## 1. Резюме

1. **Инженерная культура выше среднего.** `tsc --noEmit`, `vite build`, `npm test` (270/270),
   `npm run lint` (0), `npm run knip` (0), `npm run coverage` (95,1 / 87,4 / 95,3 % при порогах
   93/85/92), `npm run size` (455,7 КБ JS из 600, 37,7 КБ CSS из 60), `npm audit` (0) — всё зелёное.
   Чистый `git status` по отслеживаемым файлам, осмысленные коммиты с пояснением «почему».
2. **Главный риск — не в рантайме, а в цифрах, которые проект сам про себя утверждает.**
   Цифра «95,1 % покрытия» считается по 41 файлу и **не видит 41 файл `src/` (3458 строк)**:
   весь `src/ui/`, `use-pdf-background.ts`, `plan-capture.ts`, `use-snapshots.ts`,
   `use-app-effects.ts`. Реальное покрытие исходников — **≈57,8 % строк**. То же с тестами и E2E:
   README обещает 4 E2E, в репозитории 4 `test()` в 3 файлах, но `docs/HANDOFF.md:84` и `:131`
   зафиксировали «2 E2E» — контракт CI отстал от кода.
3. **Найдены P1-дефекты, которые пользователь почувствует:** `idbOpen()` открывает соединение
   на **каждую** операцию и никогда его не закрывает — ни одного `db.close()` в `src/idb.ts`
   (проверено `grep -c "db.close" src/idb.ts` → `0`); `dirty` вычисляется как
   `JSON.stringify(project) !== saved` по всему проекту **на каждый рендер**
   (`src/ui/use-workspace-state.ts:84`), а `mutate` до изменения делает `structuredClone` всего
   проекта — при 1000+ объектах это O(размер проекта) работа на кадр, то есть цель «1000+ объектов»
   из ROADMAP недостижима без смены способа определять изменения. Плюс растровый план в PDF имеет
   жёсткую ширину 1600 px (`src/plan-capture.ts:68` и `:82`), из-за чего A0 печатается в 0,47 px
   на единицу PDF.
4. **Самоописание проекта опережает факты.** `README.md:110` до сих пор пишет «версия 2.5.0» при
   релизе 2.8.0. Заявленных «231 смоук» в коде нет: фактический прогон `npm run smoke` даёт
   **233 успешные проверки, 0 провалов**. Число E2E в контракте CI (`tests/release-config.test.ts`)
   и в HANDOFF — «2», фактически 4 `test()` в 3 файлах. Ни одна из этих цифр не проверяется тестом,
   поэтому расхождение копится с 2.5.0.
5. **Данные в IndexedDB и `localStorage` защищены хуже, чем расчёты.** Квота нигде не проверяется
   (`navigator.storage.estimate()` не используется ни разу), `QuotaExceededError` от `localStorage`
   проглатывается пустым `catch` (`use-app-effects.ts:36`; `local-projects.ts:36` вообще без
   `try`), а ошибка записи в IndexedDB при импорте `.anooplan` тоже молча теряется
   (`use-project-io.ts:122`). Пользователь узнаёт о проблеме только когда проект не восстановится.
6. **Безопасность в норме для офлайн-приложения.** `INTERNET` не запрашивается, `allowBackup=false`,
   `debuggable=false`, отладка WebView только в debug-сборке, `setAllowFileAccess(false)`,
   `ShareProvider.exported=false` с защитой от path traversal (`ShareProvider.java:47`), keystore
   **не** в git (`git ls-files keystore/` пуст), `npm audit` чист, `innerHTML`/`eval` отсутствуют.
   Замечания по безопасности ниже — не уязвимости, а дефекты стойкости (см. раздел 3.7 и
   раздел 6 «осознанные компромиссы»).
7. **Express-сервер — самый слабый по гигиене модуль**: `express.json({ limit: '150mb' })` при
   лимите PDF 30 МБ (`server/app.ts:23-24`), нет rate limiting (CodeQL это уже фиксировал и находка
   была принята как «локальный сервер» — но лимит тела 150 МБ на `multer.memoryStorage` делает DoS
   тривиальным даже локально), CSP обещан в комментарии `server/app.ts:17`, но **её нет** в
   `index.html` (проверено `grep`: 0 совпадений).
8. **Мусор в рабочем дереве надо убрать из репозитория, а не «добавить в коммит»**: 7 неотслеживаемых
   объектов (3 xlsx + pdf + txt + 2 каталога), причём `КЖ Туртас (протянутые длины).xlsx` и
   `KZh_Turtas_protyanutye_dliny.xlsx` — **побитово одинаковые файлы** (`md5 6dd70d38…`), а
   `build/` занимает **1,8 ГБ** из 37 APK-версий.

**Главный вывод:** проект находится в состоянии «функционально готов, но самоописание опережает
реальность». Приоритет 2.9.0 — не новые фичи из ROADMAP, а **согласование измерений и закрытие
дыр в долговременном хранении**: честное покрытие (включая UI), лимиты/квота/ошибки IndexedDB,
регрессионный тест на публикуемые цифры. Без этого каждая следующая версия будет собирать доверие
на цифрах, которые нельзя проверить.

---

## 2. Состояние сборки и качества

Все команды запускались в `/root/Anooplan` на Linux, Node `v24.19.0` (`node -v`), с `node_modules`
из репозитория. Числа — из фактического вывода команд (полные строки в приложении).

| Проверка | Команда | Результат | Числа | Вердикт |
|---|---|---|---|---|
| Типы + сборка | `npm run build` | `✓ built in 14.54s`, `292 modules transformed` | WARN: 5 чанков >500 КБ (`export-pdf` 1171,7 КБ, `pdf-worker` 1271,1 КБ, `pdf` 543,0 КБ, `xlsx` 500,6 КБ) | ok (warning) |
| Юнит-тесты | `npm test` | `tests 270 / pass 270 / fail 0`, `duration_ms 10814` | 0 skipped, 0 todo | ok |
| Покрытие | `npm run coverage` | `all files 95.14 / 87.42 / 95.31` | строки 95,1 % (≥93) · ветки 87,4 % (≥85) · функции 95,3 % (≥92); lcov 100,4 КБ, **41 файл** | ok, но метрика занижена охватом — см. находку 9 |
| Покрытие по `src/` | ручной парсинг `coverage/lcov.info` | **41 файл вне покрытия, 3458 строк** | реально покрыто 4734/8192 строк `src/` = **57,8 %** | ⚠ P1 |
| Линт | `npm run lint` | пустой вывод, `exit 0` | 0 ошибок, 0 предупреждений | ok |
| Мёртвый код | `npm run knip` | пустой вывод, `exit 0` | 0 неиспользуемых экспортов | ok |
| Бюджет бандла | `npm run size` | `JS: 455.7 КБ из 600 КБ — ok`, `CSS: 37.7 КБ из 60 КБ — ok` | стартовый чанк `index-BxSZmK_K.js` / `index-CMTDMMQH.css` | ok |
| Уязвимости | `npm audit` | `found 0 vulnerabilities` | 8 prod / 21 dev | ok |
| Git-гигиена | `git log --oneline -20`, `git status --short` | 20 коммитов, сообщения с префиксами `docs:`/`ci:`/`2.8.0:` | 7 неотслеживаемых объектов в корне | ⚠ P2 — см. находку 25 |

**Расхождение с документацией.** README (`README.md:126`) утверждает «270 тестов, 231 смоук,
4 E2E, 4 визуальных эталона; покрытие 95,2 / 87,4 / 95,3 %; JS 455,7 КБ + CSS 37,7 КБ». Факты:
тестов и покрытия — совпадают (с точностью до 0,1 п.п. по строкам: 95,14 против заявленных 95,2 —
округление вниз, а не вверх, но допустимо), JS/CSS — совпадают побитово. **Смоук: `npm run smoke`
печатает 233 ✔ и 0 ✘ — не 231** (при этом цифра 231 не меняется в README уже с 2.5.0 —
`README.md:174`, `:159`, `:142`, `:126`). Формально это не регрессия, а устаревшая цифра: смоук
**растёт**, а README отстаёт, поэтому читатель не может отличить «так и было» от «стало хуже».
**E2E: 4 `test()` (2 в `plan-pdf.spec.ts`, по 1 в `templates-kits.spec.ts` и `medeo-font.spec.ts`)**,
но HANDOFF и `tests/release-config.test.ts` (контракт CI) ориентируются на «2 E2E».

---

## 3. Находки

Приоритеты: **P0** — блокер/потеря данных, **P1** — серьёзный дефект, **P2** — техдолг с ощутимым
эффектом, **P3** — косметика. Трудоёмкость: **S** ≤ 0,5 дня, **M** ≤ 2 дня, **L** > 2 дней.

### 3.1. Архитектура и монолиты

#### 1. `[P1]` Растровый план в PDF — фиксированные 1600 px на всю ширину листа
`src/plan-capture.ts:81-100`

```ts
const width = 1600;
const height = Math.max(1, Math.round(active ? width * floor.height / Math.max(1, floor.width) : ...));
...
viewport: page.getViewport({ scale: width / viewport.width }),
```

**Суть.** Ширина растра в PDF всегда 1600 px независимо от формата листа: A4 (842 ед. PDF) получает
≈1,9 px/ед., A0 (3370 ед.) — 0,47 px/ед. При печати A1/A0 на плоттере каждая точка PDF превращается
в «мыло» втрое крупнее, чем на A4. ROADMAP (`docs/ROADMAP.md:47`) уже признаёт это («canvas 1600 px →
PNG → „мыло“ на A1/плоттере»), но переносит в 2.8.1 и **не назначает метрику качества**.

**Последствия.** Документ «для подписи» формально есть, но для чертёжного контроля непригоден на
больших форматах — а именно A1/A0 типичны для планов зданий.

**Рекомендация.** Считать ширину из целевого DPI и листа, ограничив бюджетом памяти
(уже есть `PLAN_MAX_PIXELS` в `src/render-plan.ts:31`):

```ts
import { PLAN_MAX_PIXELS } from './render-plan';

/** Ширина растра плана в PDF: не меньше 1600 px и не больше бюджета памяти при 150 dpi. */
export function planRasterWidth(sheetWidth: number, sheetHeight: number, dpi = 150): number {
  const desired = Math.round(sheetWidth / 72 * dpi);              // 1 ед. PDF = 1/72"
  const budget = Math.floor(Math.sqrt(PLAN_MAX_PIXELS * sheetWidth / Math.max(1, sheetHeight)));
  return Math.max(1600, Math.min(desired, budget));
}
```

и покрыть тестом на A0 (3370 × 2384) и A4 (842 × 595). Это S и снимает главный «Чертёж без трения»
пункт без переписывания на вектор.

---

#### 2. `[P2]` `export-pdf.ts` — 812 строк, единственный настоящий god-object
`src/export-pdf.ts:1-812` (функции `wrapText:93`, `fitText:119`, `buildSections:497`, классы
секций, шрифты, оглавление, штамп ГОСТ, планы/фото)

**Суть.** `engine.ts` разложен в 2.6.2 до 59 строк-фасада, `App.tsx` — 37 строк, но `export-pdf.ts`
так и остался монолитом 812 строк с 20+ секциями, смешивающим три роли: компоновку страницы,
типографику и сбор доменных таблиц (`buildSections` вызывает `estimate`, `specifications`,
`specificationKnS`, `routeSectionsText` — 7 импортов из `./engine` и `./estimate`).

**Последствия.** Любая правка секции (например, «Работы/НДС» из 2.9.0) требует держать в голове
весь файл; CodeFactor уже отмечал «Complex Method». Регрессионные тесты (665 строк
`tests/export.test.ts`) прикованы к текстовому слою PDF — декомпозиция их не сломает, если API
`buildJournalPdf` сохранить.

**Рекомендация.** Минимальный распил по уже существующему шву «вёрстка / содержимое»:

```
src/pdf/page-kit.ts     — PAGE, MARGIN, wrapText, fitText, таблицы, штамп, нумерация листов
src/pdf/sections/*.ts   — по одному модулю на раздел, экспорт { id, title, render(kit, model) }
src/pdf/build.ts        — buildJournalPdf: порядок секций, оглавление, подписи
src/export-pdf.ts       — реэкспорт фасада (как src/engine.ts), чтобы UI и тесты не менялись
```

Это M (≈2 дня) и снижает риск ошибок в самом «дорогом» для пользователя артефакте.

---

#### 3. `[P2]` `use-plan-editing.ts` и `use-workspace-state.ts` — «свалка» UI-логики
`src/ui/use-plan-editing.ts:14-342`, `src/ui/use-workspace-state.ts:21-170`

**Суть.** `useWorkspaceState` держит **42** `useState`-переменных и возвращает объект из **~137**
полей; `usePlanEditing` получает его целиком через деструктуризацию (строки 15–22) и содержит
обработчики всех инструментов сразу: камеру, привязки, калибровку, прокладку трасс, кабели,
замечания, размеры, вставку вершины, долгое нажатие, pinch-zoom.

**Последствия.** Это тот «`AppUi` одним объектом», который HANDOFF (`docs/HANDOFF.md:574`)
честно фиксирует как P1-долг. Практический вред: любой новый инструмент добавляет поля в общий
блок, изменение сигнатуры задевает 30+ компонентов, а тестировать отдельный инструмент в изоляции
нельзя — только весь хук целиком (и теста на него нет, см. находку 10).

**Рекомендация.** Начать не с «распила на под-объекты» (это ровно тот шаг, который откладывают
уже три релиза), а с **выделения чистых редукторов** — они тестируются без React вообще:

```ts
// src/plan/gestures.ts — чистая логика, без DOM и без React
export function snapPoint(raw: Point, ctx: { equipment: Point[]; vertices: Point[]; gridSize: number; zoom: number }): { point: Point; snapped: boolean }
export function orthogonalize(from: Point, to: Point): Point[]
export function tapOutcome(start: { x: number; y: number; at: number }, end: { x: number; y: number; now: number }, slop: number, delay: number): boolean
```

`usePlanEditing` превращается в тонкий адаптер «событие → редуктор → mutate». Это S на первый шаг
и M на завершение, зато даёт тесты на «привязка/ортогональность/тап vs перетаскивание» — самое
багоопасное место интерфейса.

---

#### 4. `[P3]` `screens.tsx`, `workspace.tsx`, `fields.tsx`, `selects.tsx` — файлы на 9–29 строк
`src/ui/workspace.tsx:1-9`, `src/ui/fields.tsx:1-10`, `src/ui/selects.tsx:1-11`, `src/ui/screens.tsx:1-28`

**Суть.** Четыре модуля ради одной-двух строк JSX каждый; `knip` их не ловит, потому что они
используются. Это обратная крайность — дробление ради дробления.

**Последствия.** Больше импортов и файловых переходов при чтении, ноль изоляции поведения.

**Рекомендация.** Не приоритет. При следующем заходе в `src/ui/` слить в `ui/parts.tsx`.
S. **Отдельно:** не расширять эту практику — новые «файлы на 10 строк» не нужны.

---

### 3.2. Типизация

#### 5. `[P2]` Границы валидации сервера типизированы `any`, и это заглушено в ESLint
`server/validation.ts:10-12`, `:21-24`, `server/app.ts:80`, `eslint.config.js:113-119`

```ts
const object = (value: unknown, at: string): Record<string, any> => { ... }
const array = (value: unknown, at: string): any[] => { ... }
```

```js
files: ['server/**/*.ts'],
rules: { '@typescript-eslint/no-explicit-any': 'off' },
```

**Суть.** Ровно 3 вхождения `any` в проекте — все три на границе `assertProject`/`restore`. Это
оправданная точка входа нетипизированного JSON, но `Record<string, any>` тащит `any` **внутрь**
функций проверки: `context.claim(dimension[key], ...)`, `text(item.name, ...)` прощают любые
опечатки в ключах, а отключённое правило не даст предупреждения при добавлении нового поля.

**Последствия.** Ложное ощущение типовой безопасности на границе, где она нужнее всего; при
изменении модели (`src/model.ts`) компилятор не покажет места, которые надо проверить.

**Рекомендация.** Перейти на `Record<string, unknown>` + узкий локальный ассерт, где действительно
нужен доступ по строке, и вернуть правило:

```ts
type Row = Record<string, unknown>;
const object = (value: unknown, at: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at}: ожидается объект`);
  return value as Row;
};
// точечно там, где нужен произвольный ключ:
const pick = (row: Row, key: string): unknown => row[key];
```

M (296 строк валидации, но правки механические; 99,7 % строк этого файла уже покрыты тестами).

---

#### 6. `[P2]` `normalizeSegment` возвращает вход как `Segment` без проверки — типы врут
`src/migrations.ts:92-101`

```ts
function normalizeSegment(value: unknown): Segment {
  if (!isRecord(value)) return value as unknown as Segment;   // ← сюда попадает что угодно
  const segment = { ...(value as unknown as Segment) };
```

**Суть.** Если `segments[i]` не объект (строка, число, `null`), миграция **не падает и не отбрасывает
запись** — она возвращает её как «валидный `Segment`». Дальше `segment.a.floorId` в движке даёт
`TypeError` уже в расчёте, а не внятную ошибку схемы. Остальные коллекции (`floors`, `equipment`,
`routes`, `cables`, `pins`) при не-объекте бросают `ProjectSchemaError` — здесь поведение
непоследовательно.

**Последствия.** Повреждённый (или враждебно склеенный) `.anooplan`/бэкап роняет приложение
вместо сообщения «проект повреждён»; тест `tests/migrations.test.ts` (460 строк) это не ловит.

**Рекомендация.** Выровнять с соседними нормализаторами и выбросить битые сегменты с записью
в диагностику:

```ts
function normalizeSegment(value: unknown): Segment | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.a) || !isRecord(value.b)) return null;   // у сегмента обязательны концы
  const segment = { ...(value as unknown as Segment) };
  for (const key of SECTION_DIM_KEYS) { ... }
  return segment;
}
// в normalizeRoute:
segments: Array.isArray(value.segments) ? value.segments.map(normalizeSegment).filter((s): s is Segment => s !== null) : [],
```

S + тест-кейс «сегмент-строка в `segments` не роняет загрузку».

---

#### 7. `[P2]` Жёсткие утверждения (`!`) в критичных местах вместо проверок
`src/ui/use-plan-editing.ts:35` (`stage.current!.getBoundingClientRect()`),
`src/use-pdf-background.ts:89` (`p.floors.find(...)!`), `src/ui/properties-panel.tsx:59`
(две штуки `find(...)!` в обработчиках)

**Суть.** `position()` вызывается из обработчиков событий, где `stage.current` теоретически уже
мог стать `null` при размонтировании во время жеста (открыли шторку, переключили вкладку). Падение
будет `TypeError` без сообщения; оно попадёт в диагностику, но пользователь увидит белый экран
вместо баннера.

**Последствия.** Редкий, но неприятный краш на телефоне, воспроизвести можно только на устройстве.

**Рекомендация.**

```ts
function position(e: { clientX: number; clientY: number }, useSnap = true): Point | null {
  const rect = stage.current?.getBoundingClientRect();
  if (!rect) return null;
  ...
}
```

и проверка `const p = position(e); if (!p) return;` в вызывающих. S.

---

#### 8. `[P3]` `Project.schemaVersion:1|2`, но `migrateProject` всегда возвращает `2`
`src/model.ts:102`, `src/migrations.ts:259`

**Суть.** После любой загрузки проект всегда v2, значит литерал `1` в типе — мёртвая ветка,
которая заставляет каждую проверку писать `p.schemaVersion === 2 || p.schemaVersion === 1`
(см. `use-app-effects.ts:81`, `server/validation.ts:243`).

**Последствия.** Лишние ветки и шанс логической ошибки при добавлении v3.

**Рекомендация.** Оставить `schemaVersion: 1 | 2` **только** в типе «сырого» входа
(`RawProject`), а в `Project` — `schemaVersion: 2`. Вместе с появлением v3 (см. находку 16
о golden-fixtures схемы) это упростит миграции. S.

---

### 3.3. Тесты

#### 8a. `[P2]` React-предупреждение о `key` в панели свойств: смоук его не замечает
`src/ui/properties-panel.tsx:56`

```tsx
<details><summary>Дополнительные свойства</summary>
  {Object.entries(equipment.properties).map(([key, value]) => field(key, value, v => setItem('properties', { ...equipment.properties, [key]: v })))}
  <button ...>＋ Свойство</button>
</details>
```

**Суть.** `Object.entries(...).map(...)` возвращает массив элементов без `key` — единственное такое
место в панели свойств (все остальные `.map` в файле ключи ставят). Предупреждение реально
воспроизводится при `npm run smoke`: в stderr прогона стоит

```
Each child in a list should have a unique "key" prop.

Check the render method of `details`. It was passed a child from PropertiesPanel.
```

Демо-проект содержит `properties: { model: name }` (`src/demo.ts:17`), поэтому проверка срабатывает
на каждом запуске — но **не валит смоук**: скрипт считает только явные `check(...)`, а `✘` в выводе
однозначно `0`. Иными словами, единственный сторож UI-интеграции не отличает «всё хорошо» от
«React ругается».

**Последствия.** При добавлении/удалении/переименовании пользовательского свойства React будет
переиспользовать DOM-узлы по индексу — при удалении свойства фокус и ввод съедут на соседнее
поле. Это классический источник «поле показывает не то» в формах.

**Рекомендация.** Ключ по имени свойства + негативный контроль в смоуке:

```tsx
{Object.entries(equipment.properties).map(([key, value]) => (
  <Fragment key={key}>{field(key, value, v => setItem('properties', { ...equipment.properties, [key]: v }))}</Fragment>
))}
```

```js
// scripts/smoke-dom.mjs: считать предупреждения React как провал
const reactWarnings = [];
const originalError = console.error;
console.error = (...args) => { if (String(args[0]).includes('Warning:')) reactWarnings.push(args[0]); originalError(...args); };
// в конце:
check(reactWarnings.length === 0, `нет предупреждений React (найдено ${reactWarnings.length})`);
```

S. И это ровно тот «тест, который ловит настоящее», о котором говорит находка 10.

---

#### 9. `[P1]` Покрытие 95 % считается без `src/ui/` — реальный охват 57,8 %
`scripts/coverage.mjs:14` (пороги), `:17-21` (прогон), `docs/HANDOFF.md:522`

**Суть.** `coverage.mjs` прогоняет те же `tests/*.test.ts`, что и `npm test`, и пороги применяются
к «all files» того, что **случайно попало в lcov**. UI-код в юнит-тестах не импортируется, поэтому
в отчёт не попадает — и метрика выглядит на 37 п.п. лучше, чем есть. HANDOFF это признаёт
(«UI-файлы в метрику почти не входят»), но ни README, ни ROADMAP, ни релизные заметки
(`README.md:126`) этой оговорки не содержат.

**Последствия.** Главный продукт — офлайн-приложение, где половина кода это хуки и панели
(`src/ui/` 2726 строк + `use-pdf-background`/`use-snapshots`/`use-app-effects` ≈ 470 строк),
и именно они не измеряются. Регрессии в них ловятся только смоуком (233 проверки на happy-dom)
и 4 E2E.

**Рекомендация.** Две независимые строки в отчёте и в CI:

```js
// scripts/coverage.mjs
const SCOPE = process.argv.includes('--all') ? 'all' : 'tested';
// печатать оба числа и падать по порогу ТОЛЬКО на 'all', начиная с 2.9.0
const THRESHOLDS = { tested: { lines: 93, branches: 85, functions: 92 }, all: { lines: 55, branches: 50, functions: 55 } };
```

и в README/HANDOFF заменить «95,1 %» на «95,1 % по тестируемым модулям · 57,8 % по `src/` целиком».
Даже без написания новых тестов это убирает главный источник самообмана. S (полдня).

---

#### 10. `[P1]` У хуков нет прямых тестов — только через смоук и E2E
`tests/hooks.test.ts:1-80` (единственный `useProjectHistory`), `src/ui/use-*.ts` (7 хуков, 1190 строк)
+ `src/use-pdf-background.ts`, `use-project-history.ts`, `use-snapshots.ts`, `use-photo-urls.ts`
(347 строк) — **11 хуков, 1537 строк, из них покрыт один файл**

**Суть.** Всего 11 хуков; `use-project-history` проверен напрямую — и именно он в 2.6.2 нашёл
реальный баг в redo. Это лучший аргумент за подход, но работа остановилась на одном хуке:
остальные 10, включая все правила хранения данных, тестами не покрыты.

**Последствия.** Простая проверка показывает незащищённые правила:
`use-app-effects.ts:81` — восстановление черновика **только** если `project.name === 'Новый проект'`
и `equipment.length === 0`; `use-project-io.ts:32` — `if (JSON.stringify(projectRef.current) ===
JSON.stringify(snapshot))` сравнивает весь проект на каждом сохранении; `use-snapshots.ts:36` —
сортировка ключей по `Number(b.split(':')[1])` молча ломается, если `id` проекта содержит `:`.

**Рекомендация.** Три теста в существующем стиле с `happy-dom` (инфраструктура уже есть):

```ts
// tests/snapshots.test.ts
test('снимки: лимит 20, ключ <id>:<ts>, удаляется самый старый', async () => { ... });
test('снимки: id проекта с двоеточием не путает сортировку', async () => { ... });
test('автосейв-черновик не перетирает уже начатый проект', () => { ... });
```

S каждая.

---

#### 11. `[P2]` Резервная копия и `.anooplan` проверяются на happy-dom, но не в реальном WebView
`tests/project-file.test.ts:1-226`, `scripts/smoke-dom.mjs:151` (`window.confirm = () => true`)

**Суть.** Сценарий «открыть `.anooplan` из файлового менеджера» (`use-project-io.ts:89-147`,
`MainActivity.java` → `__anooplanOpenSharedProject`) проверяется юнит-тестами моста и смоуком,
где `confirm` **всегда** возвращает `true`. Ветка «пользователь отказался» (`use-project-io.ts:92`)
не покрыта нигде, а именно она защищает от потери несохранённых изменений.

**Последствия.** Ровно тот класс дефектов, который не воспроизводится на CI и всплывает на объекте.

**Рекомендация.** Один E2E, который не требует Android: `page.addInitScript` подменяет
`window.confirm` на `false` и проверяет, что после попытки открыть файл проект **не** сменился
и показано сообщение «Открытие файла отменено». Плюс второй — что данные **не** теряются, если
IndexedDB отдаёт `QuotaExceededError` (mock через `page.addInitScript`). M.

---

#### 12. `[P3]` Контракт CI не совпадает с фактическим числом тестов
`.github/workflows/ci.yml:62` (`npx playwright test`), `docs/HANDOFF.md:84`, `docs/HANDOFF.md:131`

**Суть.** CI запускает 4 E2E, а контракт и HANDOFF зафиксировали «2 E2E». Нет ни одного теста,
который проверял бы, что число смоук-проверок и E2E совпадает с заявленным в README.

**Рекомендация.** Дешёвый «тест на цифры» (см. находку 24): читать `README.md`/`docs/HANDOFF.md`
и сверять `tests`, `smoke checks` и `test()` с фактическим подсчётом:

```ts
test('цифры в README совпадают с фактом', () => {
  const smoke = (readRepoFile('scripts/smoke-dom.mjs').match(/\bcheck\(/g) ?? []).length;
  const e2e = readdirSync(join(root, 'tests/e2e')).reduce((sum, f) => sum + (readRepoFile(`tests/e2e/${f}`).match(/\btest\(/g) ?? []).length, 0);
  assert.ok(readRepoFile('README.md').includes(`${smoke} смоук`), `README должен указывать ${smoke} проверок смоука`);
  assert.ok(readRepoFile('README.md').includes(`${e2e} E2E`), `README должен указывать ${e2e} E2E`);
});
```

S.

---

### 3.4. Надёжность и офлайн-данные (IndexedDB, миграции, квоты)

#### 13. `[P1]` `idbOpen()` открывает новое соединение на каждую операцию и никогда не закрывает
`src/idb.ts:9-19`, `:21-99`

```ts
export async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await idbOpen();          // ← новое соединение
  await new Promise<void>(...);        // ← db.close() нет
}
```

**Суть.** Каждый `idbGet`/`idbPut`/`idbStoreKeys` вызывает `indexedDB.open()` заново. Загрузка
проекта с 20 фото = 20 соединений, импорт `.anooplan` с PDF + фото — ещё десятки, а GC делает
`idbStoreGetAll('snapshots')` + `idbStoreKeys('pdfs')` каждые 3 секунды после изменений
(`use-app-effects.ts:52-56`). Соединения не закрываются, живут до конца сессии.

**Последствия.** Известная особенность Chromium: при многих открытых соединениях к одной базе
`versionchange`-событие блокируется, а память под соединения растёт; на устройстве с малым
heap (`largeHeap=true` в манифесте, но WebView-процесс отдельный) это ускоряет вытеснение
страницы. Практически — редкие «зависшие» операции IndexedDB, которые проект ловит пустым
`catch { /* хранилище недоступно */ }` и **молча теряет** работу.

**Рекомендация.** Один общий промис соединения с обработчиком закрытия:

```ts
let connection: Promise<IDBDatabase> | null = null;

export function idbOpen(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { ... };
    request.onsuccess = () => {
      const db = request.result;
      // База закрыта извне (например, пользователь очистил данные) — переоткрываем при следующем вызове.
      db.onclose = () => { connection = null; };
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error ?? new Error('IndexedDB: ошибка запроса')); };
  });
  return connection;
}
```

и открыть одну транзакцию на N ключей (`writeBlobs(entries: Map<string, Blob>)`) вместо цикла
`idbPut`. S; тест в `tests/idb.test.ts` (уже есть `fake-indexeddb`) на «одно соединение».

---

#### 14. `[P1]` Квота хранилища не проверяется нигде, `QuotaExceededError` глотается
`src/ui/use-app-effects.ts:36`, `src/local-projects.ts:30-37`, `src/ui/use-project-io.ts:118-122`

```ts
// use-app-effects.ts:36
const timer = setTimeout(() => { try { localStorage.setItem('cableplan:autosave', JSON.stringify(projectRef.current)); } catch { /* переполнение localStorage */ } }, 800);
```

```ts
// local-projects.ts:36 — без try/catch вообще:
storage.setItem(PROJECTS_KEY, JSON.stringify(list));
```

**Суть.** `saveLocalProject` бросает исключение наружу (это ловит `run`, покажет баннер — хорошо),
но **автосейв-черновик** проглатывает ошибку полностью; `navigator.storage.estimate()` в проекте
не вызывается ни разу (проверено grep: 0 совпадений по `quota|QuotaExceeded|navigator.storage`).
Пользователь на телефоне с 2–4 сохранёнными проектами, PDF-планами по 10–30 МБ и фото получает
тихую потерю черновика.

**Последствия.** ROADMAP честно пишет «Нет напоминаний о бэкапе; квота хранилища не проверяется →
риск потерять проект» и ставит это в 3.0.0. Но потеря может случиться раньше, чем наступит 3.0.0.

**Рекомендация.** Минимальный каркас уже сейчас (S):

```ts
// src/storage-health.ts
export interface StorageHealth { usage: number; quota: number; ratio: number }

export async function storageHealth(): Promise<StorageHealth | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, ratio: quota ? usage / quota : 0 };
}

/** Порог, после которого просим пользователя выгрузить .anooplan. */
export const STORAGE_WARN_RATIO = 0.8;
```

Баннер `role="status"` в `App.tsx` (рядом с `ui.error`), плюс счётчик неудачных автосейвов
вместо пустого `catch`:

```ts
catch (error) {
  logDiagnostic('error', error, 'autosave-local');
  setMessage('Черновик не сохранён: в браузере кончилось место. Выгрузите проект в .anooplan.');
}
```

S–M.

---

#### 15. `[P2]` Импорт `.anooplan` теряет вложения молча
`src/ui/use-project-io.ts:118-135`

```ts
try { const localKey = uid(); await idbPut(localKey, pdfBlob); pdfKeys.set(pdf.id, 'idb:' + localKey); }
catch { /* вложение не сохранилось — проект всё равно открываем */ }
```

**Суть.** Если PDF не записался (квота, приватный режим), проект открывается **без подложки**, а
пользователь видит только «Проект открыт из файла». Дальше этаж рисуется пустым листом; в PDF-плане
будет «оверлей не нанесён» (механика есть в `plan-pages.ts`), но на экране — просто нет подложки.

**Последствия.** Пользователь думает, что файл битый, хотя виновата квота; отлаживать придётся
по `diagnostics`, который он должен ещё уметь выгрузить.

**Рекомендация.** Собрать список потерь и показать его одним сообщением:

```ts
const lost: string[] = [];
...
catch (error) { logDiagnostic('error', error, 'attach-pdf'); lost.push(`PDF ${pdf.name || pdf.id}`); }
...
if (lost.length) setError(`Проект открыт, но вложения не сохранились: ${lost.join(', ')}. ` +
  `Проверьте свободное место и повторите импорт.`);
```

S.

---

#### 16. `[P2]` Миграционный слой обещает «v3 без потерь», но версии схемы не обучают нормализации
`src/migrations.ts:39-45`, `:234-250`

```ts
const MIGRATIONS: Record<number, (project: RawProject) => RawProject> = {
  1: project => ({ ...project, schemaVersion: 2, pins: [] }),
};
```

**Суть.** Каркас миграций работает, но **все** необязательные поля (цвета, сечения, справочник,
`document`) нормализуются **вне** миграций — в едином `migrateProject`. Значит, добавление v3
(например, обязательная единица измерения у кабеля) потребует либо миграции, которая умеет читать
«старый» формат, либо ещё одной порции веток `typeof value.x === 'string'`. Второй путь уже стал
нормой: `normalizeEquipment`, `normalizeRoute`, `normalizeCable` — это 160 строк условной
нормализации без версии.

**Последствия.** Чем дальше, тем дороже вводить строгую схему: сейчас нет способа отличить «поле
отсутствует, потому что его не было в v2» от «поле испорчено». Риск — тихая потеря данных при
будущем ужесточении.

**Рекомендация.** Уже сейчас добавить тест-«прогулку по версиям» (golden fixtures) и зафиксировать,
что нормализация идемпотентна:

```ts
test('migrateProject идемпотентна: migrate(migrate(x)) === migrate(x)', () => {
  for (const fixture of fixtures) assert.deepEqual(migrateProject(migrateProject(fixture)), migrateProject(fixture));
});
```

и хранить по одному JSON-файлу на версию в `tests/fixtures/schema/v1.json`, `v2.json`.
Это S и даёт бесплатный регресс при введении v3.

---

#### 17. `[P2]` GC запускается по таймеру на каждое изменение истории и не учитывает `snapshots` проекта из `.anooplan`
`src/ui/use-app-effects.ts:52-56`, `src/garbage-collector.ts:12-29`

**Суть.** Эффект зависит от `project, undo, redo, staticMode` — то есть на **каждое** изменение
проекта в `staticMode` ставится таймер 3 с, который читает **все** снимки (`idbStoreGetAll`),
все ключи (`idbStoreKeys`) и перебирает `readLocalProjects()`. На 20 снимках проектов по 1000
объектов это заметная работа, которая повторяется после каждого движения мышью (каждое движение
даёт `mutate` → новый `project`).

**Последствия.** Постоянная фоновая нагрузка на устройстве; кроме того, GC удаляет блобы, если
на них нет ссылки **в текущих состояниях**, — а файл `.anooplan`, который пользователь только что
экспортировал, содержит **копию** блобов, не связанную с хранилищем, поэтому тут проблемы нет;
но при импорте `.anooplan` PDF кладётся под новым ключом, и старый ключ из файла становится
сиротой — корректно.

**Рекомендация.** Запускать GC не по изменению проекта, а по событию «после паузы правок» с
debounce на `updatedAt` и ограничением частоты:

```ts
useEffect(() => {
  if (!staticMode) return;
  const timer = setTimeout(() => { void collectStorageGarbage([projectRef.current, ...undo, ...redo]); }, 3000);
  return () => clearTimeout(timer);
}, [project.updatedAt, undo.length, redo.length, staticMode]);   // ← не весь project
```

и внутри `collectStorageGarbage` кэшировать `readLocalProjects()` на время вызова (одна функция
читает его второй раз через `unusedStorageKeys` → `referencedStorageKeys`).
S. Оговорка: это эвристика, которая опирается на то, что мутации всегда меняют `updatedAt`
(`use-project-history.ts:38` — меняют), поэтому эквивалентна по корректности.

---

#### 18. `[P3]` Снимки версий: ключ `<id>:<timestamp>` и сортировка по `split(':')[1]`
`src/use-snapshots.ts:32-37`, `:48-50`

**Суть.** Идентификатор проекта — UUID (без `:`), но `load()`/`migrateProject` допускает **любой**
`id` из файла (`src/migrations.ts:254`). Проект, пришедший из `.anooplan` с `id = "акт:1"`,
сломает и фильтр `startsWith(`${id}:`)`, и сортировку.

**Последствия.** История версий покажет чужой/пустой список; лимит 20 не сработает → рост хранилища.

**Рекомендация.** Запретить `:` в `id` при нормализации либо строить ключ через безопасный
кодировщик:

```ts
const snapshotKey = (projectId: string, at: number) => `${encodeURIComponent(projectId)}:${at}`;
```

S.

---

### 3.5. Производительность (большие планы, SVG, PDF)

#### 19. `[P1]` `dirty` — это `JSON.stringify` всего проекта на **каждый** рендер
`src/ui/use-workspace-state.ts:84`, `src/use-project-history.ts:28-40`

```ts
const dirty = JSON.stringify(project) !== saved;
```

**Суть.** `setZoom`, `setPan`, `setPointer` — любой из 42 `useState` вызывает рендер, и на каждом
рендере проект целиком сериализуется в сравнение со строкой `saved`. `mutate` в свою очередь
делает `clone(previous)` (structuredClone всего проекта) **до** изменения — то есть на каждое
перетаскивание оборудования: 1 клон + 1 stringify. При 1000 объектах и 10 КБ/объект это ~10 МБ
строк на кадр.

**Последствия.** ROADMAP ставит «1000+ объектов» целью 3.0.0, но текущая архитектура делает
это физически недостижимым без изменения способа определять «изменено». На реальном объекте
с ~500 объектами движение мышью уже даёт видимые пропуски кадров.

**Рекомендация.** Заменить сравнение на счётчик ревизий (подпись модели), который меняет **только**
`commit`/`record`/`history`:

```ts
// use-project-history.ts
const [revision, setRevision] = useState(0);
const [savedRevision, setSavedRevision] = useState(0);
const markSaved = () => setSavedRevision(revision);
const dirty = revision !== savedRevision;
// в commit(): setRevision(r => r + 1)
```

Эквивалентность: `saved` сейчас используется ещё и для `setSaved(JSON.stringify(result))` при
ответе сервера — этот путь надо перевести на `markSaved()`. M, но эффект — на порядок меньше
работы на кадр. Промежуточный шаг (S): мемоизировать `dirty` по `project.updatedAt`, который уже
меняется в `commit` (`use-project-history.ts:38`) —

```ts
const dirty = useMemo(() => JSON.stringify(project) !== saved, [project.updatedAt]); // всё ещё O(n), но один раз на мутацию
```

---

#### 20. `[P2]` Повторный расчёт всех кабелей: 3 полных прохода на рендер
`src/ui/use-workspace-state.ts:94-122`, `src/engine/geometry.ts:183-186`

**Суть.** На каждый `project` считаются: `issues` (`validateProject` + `domainWarnings`), `cableCalcs`
(по одному `calculateCable` на кабель), `fill` (`trayFill`), `totals` (**ещё** по одному
`calculateCable` на кабель). При этом `calculateCable` сам вызывает `segmentIndex(project)` —
обход всех сегментов всех трасс (строка 185). Для 100 кабелей × 500 сегментов это 50 000 итераций
× 2 прохода + `trayFill` + warnings.

**Последствия.** На планшете с 300+ кабелями правка одного поля ощутимо лагает; `domainWarnings`
внутри `issues` заново считает `trayFill` (см. `src/engine/specification.ts:189`).

**Рекомендация.** Один «модельный» объект, который пересчитывается один раз и передаётся вниз:

```ts
// src/engine-model.ts
export function buildModel(project: Project) {
  const index = segmentIndex(project);             // ← один раз
  const calcs = new Map(project.cables.map(c => [c.id, calculateCableWithIndex(project, index, c)]));
  const fill = trayFill(project);                  // ← один раз
  const issues = [...validateProject(project), ...domainWarningsWithFill(project, fill)];
  const totals = sumTotals(project.cables, calcs);
  return { calcs, fill, issues, totals };
}
```

и один `useMemo(() => buildModel(project), [project])`. `totals` перестаёт дублировать расчёт
целиком (сейчас `useMemo` из `project` внутри `totals` ещё и **никогда** не мемоизируется
отдельно от верхнего — см. строка 114). M, эффект — «2–3× меньше расчётов на рендер».

---

#### 21. `[P2]` SVG-оверлей плана рисует все объекты всех этажей и пересоздаётся целиком
`src/ui/plan-screen.tsx:62-116`

**Суть.** Один `<svg>` на лист с `width/height` в единицах PDF; все сегменты, вершины, оборудование
и замечания рисуются React-элементами, а обработчики `onPointerDown`/`onDoubleClick` создаются
как **inline-стрелки на каждый объект каждый рендер** (строка 68 — обработчик длиной ~400 символов).
Фильтрация по этажу есть (`filter(eq => eq.floorId === floor.id)`), но для сегментов проверка
условия внутри цикла (`if (!onFloorA && !onFloorB) continue`) означает, что при 10 этажах мы
10 раз перебираем все сегменты.

**Последствия.** На плане 500+ сегментов — 500 DOM-узлов SVG и 500 новых замыканий на рендер;
вместе с находкой 19 это главная причина лагов. Плюс `pointerEvents` на каждом сегменте ловит
панораму.

**Рекомендация.** (a) Мемоизировать подграф на этаж: `useMemo(() => segmentsForFloor(project, floorId), [project.routes, floorId])`;
(b) для взаимодействий использовать **делегирование** на `<svg>` (как уже сделано для контекстного
меню через `closest('[data-object]')` в `plan-screen.tsx:50-51`) и снять inline-обработчики с каждого
узла; (c) при >300 сегментов включать `shape-rendering="optimizeSpeed"` и группировать сегменты
одной трассы в один `<path>` (`d="M x1 y1 L x2 y2 M ..."`). M.

---

#### 22. `[P2]` Пять чанков >500 КБ, стартовый бюджет почти выбран — а `pdf-worker` упакован дважды
`vite.config.ts:8-11`, вывод `npm run build`

**Суть.** `dist/assets/pdf-worker-BXCAv0YE.js` весит **1271 КБ**, `export-pdf` — 1171 КБ,
`pdf` — 543 КБ, `xlsx` — 500 КБ. При этом внутри APK `assets/www` лежит полная копия `dist`
(4,1 МБ), и все эти чанки физически занимают место, даже если пользователь никогда не экспортирует
XLSX. Бюджет `size` смотрит только стартовый `index-*.js` (600 КБ), поэтому рост остальных чанков
никак не контролируется, хотя ROADMAP декларирует «APK ≤4 МБ».

**Последствия.** APK уже 1,6 МБ при 4,26 МБ распакованных; рост `export-pdf`/`pdf-worker` не
поймает ни один CI-шаг (это подтверждается: `npm run size` покажет «ok» при любом размере
`export-pdf`).

**Рекомендация.** Расширить `scripts/check-size.mjs` на **суммарный** размер всех JS-чанков
и на APK, и добавить шаг, который предупреждает при >3 чанках свыше 500 КБ:

```js
const TOTAL_BUDGET = 4000 * 1024;   // все JS-чанки, без шрифтов
const total = pick(/\.js$/).reduce((sum, item) => sum + item.size, 0);
```

S. Отдельно — проверить, действительно ли нужен **legacy**-билд `pdfjs-dist/legacy/build/pdf.mjs`
(он вдвое больше `build/pdf.mjs`); если WebView 98+ это подтверждённое требование, оставить,
но зафиксировать это в комментарии `vite.config.ts` и в бюджете.

---

#### 23. `[P3]` `use-pdf-background` держит второй canvas в памяти без лимита
`src/use-pdf-background.ts:35`, `:113`

```ts
const pdfCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
...
if (!renderPlanValue.clipped) pdfCache.current = { key, canvas: offscreen };
```

**Суть.** Полный лист рисуется в `offscreen`, затем копируется в `canvas.current` и хранится
**ещё раз** для быстрого показа при повторном заходе. Для A3 в 2× DPR это два canvas по
~16 Мпикс ≈ 64 МБ RGBA. Бюджет `PLAN_MAX_PIXELS` ограничивает **один** canvas, не два.

**Последствия.** На устройстве с 2 ГБ RAM и `largeHeap` WebView может выгрузить страницу при
переключении приложения — пользователь потеряет несохранённое состояние (а `beforeunload` в WebView
не спасает).

**Рекомендация.** Либо не дублировать canvas (перерисовывать из PDF заново при повторном заходе —
дешевле по памяти, дороже по CPU), либо явно удвоить бюджет:

```ts
/** Два canvas одновременно: отрисованный и кэш для повторного показа. */
const PLAN_CACHE_PIXELS = PLAN_MAX_PIXELS / 2;
```

и в `planMemoryWarning` учитывать оба. S.

---

### 3.6. UX и доступность

#### 24. `[P1]` Документация проекта расходится с продуктом — в трёх местах, легко проверить
`README.md:110`, `README.md:15`, `.gitignore:1-17`

**Суть.**

- `README.md:110`: «`com.anooplan.app`, minSdk 24, targetSdk 35, **версия 2.5.0**» — при релизе 2.8.0.
- `README.md:15`: «около 1,5 МБ» — по факту `build/AnOOPlan-2.8.0.apk` = **1 595 955 Б** (1,52 МиБ),
  совпадает с `docs/ROADMAP.md:24`.
- `.gitignore` не содержит ни `*.xlsx/.pdf/.txt`, ни `dl/`, ни `work/` — отсюда 7 неотслеживаемых
  объектов в корне (`git status --short`), см. находку 25.

**Последствия.** README — первое, что читает человек, который передаёт проект или начинает с ним
работать (это видно по HANDOFF: «прочитайте полностью перед первым действием»). Неверная версия
и неверный размер — самая заметная мелочь, которая подрывает доверие ко всем остальным цифрам
(а находка 9 показывает, что и с покрытием так же).

**Рекомендация.** Заменить ручные цифры на генерируемый блок и проверять его тестом (см. 12):

```md
<!-- auto:version -->
- APK 2.8.0 (`versionCode 39`), 1 595 955 Б, minSdk 24, targetSdk 35
<!-- /auto:version -->
```

```bash
node scripts/status.mjs --write-readme   # обновляет блок из package.json и build/*.apk
```

S. Отдельно — «версия 2.5.0» в разделе про Android это просто опечатка из 2.5.0, но её
не поймал ни один обзор за 6 релизов.

---

#### 25. `[P2]` 7 неотслеживаемых объектов в корне + 1,8 ГБ артефактов в `build/`
`git status --short`, `build/` (37 APK × 2 файла `.idsig`)

**Суть.** В корне лежат **побайтово одинаковые** `КЖ Туртас (протянутые длины).xlsx` и
`KZh_Turtas_protyanutye_dliny.xlsx` (md5 `6dd70d389be73905270d96ce2e0cfa67`), плюс
`KZh_Turtas.xlsx`, `eq_all.txt`, `equipment_layout.pdf`, каталоги `dl/` (копия того же xlsx +
`serve.py`) и `work/` (Python-скрипты и PNG-скрины `dimchain*.png`, `__pycache__`).
Это не исходники проекта: ни один файл из `src/` на них не ссылается (проверено: в `src/` нет
строк `Turtas`, `eq_all`, `equipment_layout`).

**Последствия.** `git status` всегда «грязный», поэтому настоящая правка от незакоммиченной
работы не отличается; `dl/serve.py` и `work/build.py` — одноразовые скрипты, которые кто-то может
принять за часть сборки. `build/` (1,8 ГБ) в `.gitignore` есть, но локально растёт без ограничения
(37 APK × 2 = 74 файла + 5 «release-*» дублей).

**Рекомендация.**

```gitignore
# Рабочие материалы (не часть проекта)
/*.xlsx
/*.pdf
/*.txt
/dl/
/work/
```

и перед этим — **вручную перенести** нужное (если `work/calc.py` содержит формулы, которые стоит
сохранить, — оформить как `docs/research/`). `build/` чистить `rm -rf build/AnOOPlan-1.*` раз в
несколько релизов; `scripts/build-apk.sh` уже кладёт артефакт по имени версии, так что удаление
старых безопасно. S. **Важно: это единственная находка, которую я не исправлял** — правило
ревью запрещает трогать файлы.

---

#### 26. `[P2]` Интерфейс плана недоступен с клавиатуры и для скринридера
`src/ui/plan-screen.tsx:62-116`, `src/PlanAccessibilityList.tsx:1-28`

**Суть.** Все объекты плана — `<g>`/`<circle>`/`<line>` с `onPointerDown`/`onDoubleClick`,
`tabIndex=0` нет ни одного (проверено: 0 совпадений в `src/`), роли/`aria-*` на объектах нет.
Текстовая альтернатива `PlanAccessibilityList` **только читает** перечень — выбрать объект,
подвинуть его стрелками (обработчик стрелок существует, `use-app-effects.ts:103-115`) с клавиатуры
невозможно, потому что `selection` нечем установить. `eslint-plugin-jsx-a11y` это не ловит по
двум причинам, обе проверены экспериментом:

1. Правила `jsx-a11y/no-static-element-interactions` и `jsx-a11y/click-events-have-key-events`
   **входят** в `jsx-a11y.flatConfigs.recommended` (34 правила, проверено чтением
   `node_modules/eslint-plugin-jsx-a11y`) и не отключены в `eslint.config.js` (grep по `jsx-a11y/`
   даёт одну строку — настройку `label-has-associated-control`).
2. Эти правила срабатывают только на **HTML**-элементах: пробный файл с `<div onPointerDown>`
   и `<span onClick>` даёт 2 ошибки, а `<g onPointerDown><circle onClick /></g>` — **0 ошибок**.

То есть линтер здесь бессилен не из-за конфигурации, а потому что SVG-графика вынесена за пределы
его модели; своего эквивалента проверки (как у `<a>`/`<button>`) в проекте нет.

**Последствия.** Работа с планом — единственный способ что-то сделать в приложении, и он закрыт
для пользователей с моторными нарушениями и для скринридера (список читается, но управлять
нельзя). Заявленная в README «доступность» ограничена списками и размерами шрифта.

**Рекомендация.** Минимальный шаг (S): сделать `PlanAccessibilityList` управляемым — обернуть
каждый элемент в `<button>` с `aria-pressed` и `onClick={() => setSelection(...)}`, чтобы список
стал панелью объектов для клавиатуры:

```tsx
<li key={item.id}>
  <button type="button" aria-pressed={selected?.id === item.id} onClick={() => selectObject('equipment', item.id)}>
    {item.number}, {item.name}, {item.type}, X {item.x}, Y {item.y}{...}
  </button>
</li>
```

Плюс (M) — `tabIndex={0}` на SVG-объекты и `role="button"` с обработчиком `Enter`. Это укладывается
в 2.9.0 как «a11y-минимум» и не требует переделки плана.

---

#### 27. `[P3]` `window.confirm` для разрушительных действий — 11 вызовов, тест подменяет на `true`
`src/ui/use-project-io.ts:37,52,92`, `src/ui/use-object-actions.ts:62,87`,
`src/ui/segment-editor.tsx:115`, `src/ui/plan-screen.tsx:39`, `src/ui/chrome.tsx:95`,
`src/ui/estimate-screen.tsx:175`, `src/ui/properties-panel.tsx:59`

**Суть.** Все подтверждения — нативные `window.confirm`: без имени файла, без «Отмена/Удалить»,
без переноса строк на телефоне (Android показывает системный диалог с текстом в одну строку),
без возможности отменить после. В WebView `confirm` блокирует поток и на старых устройствах
иногда не отдаёт фокус обратно.

**Последствия.** Удаление этажа (самое опасное действие, `properties-panel.tsx:59`) подтверждается
одной строкой; пользователь на телефоне чаще жмёт «ОК» наугад. Тесты это не проверяют
(`smoke-dom.mjs:151` — `confirm = () => true`).

**Рекомендация.** Один компонент `<ConfirmDialog>` (в `src/ui/` уже есть шторки — паттерн готов),
с явными кнопками и объектом в тексте; заменить по мере правки файлов. S на компонент, M на замену
всех 14 мест.

---

#### 28. `[P3]` «Сохранить» не говорит, куда сохраняется; режимы «Сервер»/«Браузер» не видны
`src/ui/use-project-io.ts:22-35`, `src/ui/chrome.tsx`

**Суть.** В `staticMode` сообщение «Проект «X» сохранён в браузере», в серверном — «сохранён».
В APK режим всегда «Браузер», и пользователь не видит, что данные лежат в WebView-хранилище
и исчезнут при «Очистить данные» приложения. `About` показывает версию и диагностику, но не
режим хранения и не занятое место (это заявлено в ROADMAP как 3.0.0).

**Рекомендация.** В `Footer` (уже есть) вывести строку состояния:
`Хранилище: браузер · 42,7 МБ · снимков 6` — данные есть в `idb`/`storageHealth` (после находки 14).
S.

---

### 3.7. Безопасность и валидация ввода

#### 29. `[P2]` `express.json({ limit: '150mb' })` при лимите PDF 30 МБ и `multer.memoryStorage()`
`server/app.ts:23-24`

```ts
app.use(express.json({ limit: '150mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0 } });
```

**Суть.** `POST /api/restore` принимает backup с PDF в base64 **в теле JSON**, и лимит 150 МБ +
`memoryStorage` означает, что один запрос может занять ~150 МБ JSON + 100 МБ декодированных буферов
одновременно (base64 раздувает на 33 %, плюс `Buffer.from` копия). `assertProject` проверяет
структуру, но **после** полного парсинга.

**Последствия.** CodeQL уже отмечал `js/missing-rate-limiting` — принято как «локальный сервер».
Но и для локального это означает: зависшая вкладка или злонамеренная страница, открытая в том же
браузере, может отправить 150 МБ и уронить dev-сервер вместе с несохранённой работой (SQLite WAL).

**Рекомендация.** Снизить до реального сценария и ограничить параллельность:

```ts
app.use(express.json({ limit: '64mb' }));                       // 2 PDF по 30 МБ в base64 ≈ 80 МБ → 1 PDF на запрос
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0 } });
app.use((_req, res, next) => res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'), next…);
```

Плюс — `app.use('/api', rateLimit)` без зависимости (простой token-bucket на 20 req/мин) или
задокументировать принятый риск в HANDOFF рядом с находкой CodeQL. S.

---

#### 30. `[P1]` CSP обещана в комментарии, но её нет; `AssetServer` отдаёт `Access-Control-Allow-Origin: *`
`server/app.ts:16-22`, `index.html:1-40`, `android/java/com/anooplan/app/AssetServer.java:73-80`

```ts
// server/app.ts:17
// CSP для статики задаётся мета-тегом в index.html.
```

```java
// AssetServer.java:74-78
result.put("Cache-Control", "no-cache");
result.put("Access-Control-Allow-Origin", "*");
```

**Суть.** `grep -n "Content-Security-Policy" index.html` → 0 совпадений. То есть комментарий
описывает механизм защиты, которого нет, и на него ссылается внешний аудит HANDOFF («добавлены
`X-Content-Type-Options` и `Referrer-Policy`»). В APK `AssetServer` вдобавок ставит
`Access-Control-Allow-Origin: *` **для всех** отдаваемых ассетов, включая `index.html`.

**Последствия.** В офлайн-WebView XSS-поверхность мала (контент не грузится из сети, `innerHTML`
не используется), поэтому это не «уязвимость сегодня». Но для веб-версии на GitHub Pages отсутствие
CSP — реальный риск: любой будущий `innerHTML` (или сторонний сниппет) сразу даёт исполнение.
Комментарий, обещающий защиту, хуже, чем его отсутствие: он создаёт ложную уверенность.

**Рекомендация.** Либо добавить, либо удалить комментарий. Добавление — одна строка (но проверить
работу `data:` для `import()` и для SVG-оверлея):

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
               img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
               base-uri 'none'; form-action 'none'">
```

`'unsafe-inline'` для `script-src` нужен из-за встроенного ES5-детектора `webview-warning`
(`index.html:32-45`); его можно вынести в отдельный файл и убрать `'unsafe-inline'`. S. И убрать
`Access-Control-Allow-Origin: *` из `AssetServer` — в офлайн-приложении он не нужен ни одному
запросу (проверено: `fetch('/api/pdfs/…')` используется только в серверном режиме).

---

#### 31. `[P2]` Валидация XLSX/CSV импорта не ограничивает размер и не проверяет тип по содержимому
`src/catalog-file.ts:1-14`, `src/catalog-import.ts:52-100`

**Суть.** `readCatalogFile` читает **весь** файл в память (`await file.arrayBuffer()`) до любой
проверки. `xlsx` — самая уязвимая зависимость проекта (в истории уже была замена 0.18.5 → 0.20.3
из-за ReDoS, `README.md:261`), а файл приходит из «поделиться»/файлового менеджера. Ограничения
на число строк/колонок нет: `parseCatalogRows` перебирает все строки листа.

**Последствия.** Файл 200 МБ или «zip-bomb»-подобная книга легко переполнит память WebView,
и пользователь потеряет несохранённую работу. Это не RCE (xlsx-парсер в CLIENT), но реальный DoS
на своём же устройстве.

**Рекомендация.** Проверять размер до чтения и ограничивать лист:

```ts
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
if (file.size > MAX_CATALOG_BYTES) throw new Error(`Файл справочника больше ${MAX_CATALOG_BYTES / 1024 / 1024} МБ`);
...
const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: false })
  .slice(0, 5000);
```

S. Плюс тест «файл 9 МБ → понятная ошибка, приложение живо».

---

#### 32. `[P3]` `decodePdf` принимает любой файл, начинающийся с `%PDF-`
`server/validation.ts:290-296`

```ts
export function isPdf(bytes: Buffer): boolean { return bytes.length >= 5 && bytes.length <= 30 * 1024 * 1024 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'; }
```

**Суть.** Проверка сигнатуры — всё, что делает сервер. Дальше PDF уходит в `pdfjs.getDocument`
на клиенте, где исторически были RCE (`GHSA-hq66-cqwq-w95j`, исправлена в 6.4.299 — `tests/deps.test.ts`
это фиксирует). Для локального сервера это скорее гигиена, чем защита.

**Рекомендация.** Не менять (полноценный парсинг PDF на сервере — избыточно), но зафиксировать
в HANDOFF как принятое ограничение и держать `tests/deps.test.ts` (уже есть).
P3, действий нет.

---

#### 33. `[P3]` Комментарий `eslint.config.js` содержит неактуальное обоснование и статичные исключения
`eslint.config.js:95-137`

**Суть.** Исключения сформулированы как «файлы, которые правят параллельные задачи в 2.5.0» и
«запрещены к правке в 2.5.0». 2.5.0 давно вышла, задачи закрыты, а `no-unused-vars` остаётся
выключенным для 5 UI-файлов, `prefer-const` — для `src/engine.ts` и `smoke-dom.mjs`.

**Последствия.** Пять файлов `src/ui/` никогда не получат диагностику о мёртвых переменных —
а это ровно те файлы, где больше всего деструктуризации (26 полей в `use-app-effects.ts:17-21`).

**Рекомендация.** Включить правило и удалить неиспользуемые деструктурированные поля (это заодно
документирует реальные зависимости хуков — см. находку 3):

```js
// eslint.config.js — удалить блок с no-unused-vars: 'off' для src/ui/*
```

S; `npm run lint` покажет точный список.

---

### 3.8. Сборка, CI и релиз

#### 34. `[P2]` `deploy.yml` ставит Node 22 при `engines`-требовании Node ≥ 22.5 и `node:sqlite`
`.github/workflows/deploy.yml:38-40`, `README.md:80`

```yaml
- uses: actions/setup-node@... # node-version: 22
```

**Суть.** Остальные workflow используют Node 24; Pages-деплой — 22. `node:sqlite` (используется
в `server/store.ts`) требует ≥ 22.5 и в 22.x ещё `--experimental-sqlite`; `deploy.yml` не запускает
сервер, но **запускает `npm test`**, а среди тестов есть `tests/api.test.ts` (288 строк), который
поднимает SQLite через `createApp`. То есть деплой может упасть на «experimental»/недоступном API
при смене minor-версии 22.x.

**Последствия.** Непредсказуемый красный деплой при зелёном CI — худший вариант: основной CI
зелёный, а публикация блокируется.

**Рекомендация.** Выровнять на 24 и зафиксировать в `package.json`:

```json
"engines": { "node": ">=24" }
```

S. Проверить на текущем окружении **не удалось**: Node 22 не установлен, поэтому падение
`deploy.yml` — гипотеза по коду, не воспроизведённый факт.

---

#### 35. `[P2]` `build-apk.sh` собирает `vite build` **без** `tsc --noEmit`, и APK попадает в релиз мимо типов
`scripts/build-apk.sh:71-72`, `.github/workflows/android-release.yml:78-84`

```bash
say "1/7 Сборка веб-приложения (Vite)"
[ -d node_modules ] || npm install --no-audit --no-fund
npx vite build
```

**Суть.** `android-release.yml` прогоняет `npm test` и `npm run smoke`, но **не** `npm run lint` /
`tsc --noEmit` перед `build-apk.sh`; сам скрипт тоже собирает Vite без проверки типов. Vite
не типизирует (esbuild стирает типы), поэтому релизный APK может быть собран из кода, который
`tsc` отверг бы — в CI это не поймается.

**Последствия.** Дыра в самом важном артефакте: подписанный APK проверяется на сертификат и
`badging`, но не на типы.

**Рекомендация.** Одна строка в скрипте:

```bash
say "1/7 Проверка типов и сборка веб-приложения"
npx tsc --noEmit
npx vite build
```

S. Тот же вызов уже есть в `ci.yml` и `android-apk.yml` — просто не доходит до релизного пути.

---

#### 36. `[P3]` `tests/deps.test.ts` — единственный «пин» зависимости по версии
`tests/deps.test.ts:1-12`

**Суть.** Тест проверяет, что `pdfjs-dist` ≥ 6.2.108 (обход CVE), и это правильно. Но `xlsx`
(вторая самая рискованная зависимость, ставится с `cdn.sheetjs.com` по URL, а не из npm) вообще
не покрыт — и потому `xlsx 0.20.3` не обновляется автоматически: npm не отслеживает её в
`npm audit` (в отчёте `npm audit` → `found 0 vulnerabilities`, но xlsx из tarball-URL **не входит
в аудит**). Проверить это утверждение точно **не удалось** (офлайн-аудит показывает 0, а политика
npm для URL-зависимостей не документирована в проекте).

**Рекомендация.** Добавить тест-напоминание и запись в HANDOFF о том, что `xlsx` обновляется
вручную со SheetJS CDN; при обновлении — фиксировать хеш tarball'а в комментарии `package.json`.
S.

---

### 3.9. Android / APK

#### 37. `[P2]` `MainActivity.java` — 611 строк, второй монолит проекта
`android/java/com/anooplan/app/MainActivity.java:1-611`

**Суть.** В одном классе: настройка WebView, `AssetServer`, `FileChooserClient`, камера и MediaStore,
`captureIntent` (VIEW/SEND), `deliverPendingFile`, `onBackPressed`, `onConfigurationChanged`,
`NativeBridge.Host`, печать. Это тот же класс проблем, что `export-pdf.ts`, но на Java и без
юнит-тестов вообще (тесты `tests/android-config.test.ts` — 248 строк — это **grep по тексту**
файлов, не исполнение кода).

**Последствия.** Любая правка жизненного цикла рискует задеть обработку `.anooplan`; тестов
на исполнение нет, проверка только вручную на эмуляторе (HANDOFF это признаёт).

**Рекомендация.** Разделить по уже очерченным швам (классы уже почти выделены как внутренние):
`ShareIntentHandler` (captureIntent/deliverPendingFile), `WebAppSetup` (WebView settings),
`FileChooserClient` (уже вложенный) — в отдельные файлы. Плюс один robolectric-тест на
`textZoomPercent` и на `captureIntent` с фейковым `Intent` (это единственные чистые функции).
M.

---

#### 38. `[P2]` `largeHeap="true"` при бюджете памяти 8 Мпикс и двойном canvas
`android/AndroidManifest.xml:17`, `src/use-pdf-background.ts:35`

**Суть.** `largeHeap` увеличивает лимит памяти **процесса приложения**, но WebView рендерит
в отдельном процессе (Chromium sandboxed renderer) и `largeHeap` на него не действует. Значит,
флаг даёт ложное ощущение запаса, а реальная уязвимость — два canvas (находка 23) и 8 Мпикс.
Проверить на устройстве, действует ли флаг на WebView renderer, **не удалось** (нет подключённого
устройства; `android_devices` пуст).

**Рекомендация.** Оставить флаг (он помогает Java-стороне при чтении 40 МБ `.anooplan` в `String`),
но задокументировать, что он не защищает WebView; при этом на входе в `captureIntent` уже есть
лимит 40 МБ, и это правильное место для ограничения. P2 — только документация + проверка на
устройстве.

---

#### 39. `[P3]` Release-подпись: keystore локально лежит в рабочем дереве рядом с паролем
`keystore/anooplan.jks`, `keystore/pass.txt`, `keystore/README.txt`, `.gitignore:10-15`

**Суть.** `keystore/` в `.gitignore` и **не в истории** (`git ls-files keystore/` пуст,
`git log --all -- keystore/` пуст) — это правильно. Но на машине разработчика `pass.txt` (0600)
соседствует с `.jks` (0600), а `README.txt` прямо указывает путь к паролю. Риск — случайная
потеря/кража файла (из бэкапа, из `homedir`-синхронизации), а не утечка через git.

**Рекомендация.** Документировать (в `docs/RELEASE.md`) требование хранить `pass.txt` вне
рабочей директории (`$HOME/.config/anooplan/ks.env`) и проверять в `build-apk.sh` права 0600
(сейчас `chmod 600` ставится только при генерации нового ключа, `scripts/build-apk.sh:178`).
P3, действий в коде нет.

---

#### 40. `[P3]` `.idsig` и старые APK в `build/` не удаляются
`build/` (1,8 ГБ, 37 файлов `.apk` + 37 `.idsig`)

**Суть.** `scripts/build-apk.sh` пишет `OUT_APK` = `build/AnOOPlan-<version>.apk` и apksigner
создаёт рядом `.idsig`. Ничего не чистится; вручную появились дубликаты `release-261.apk`,
`release-270.apk`, `release-280.apk`, `release-check.apk` (последний — по имени «проверочный»,
но лежит с боевыми).

**Рекомендация.** Добавить в скрипт очистку старше N версий или просто `say` с подсказкой; главное —
убрать из `build/` файлы `release-*.apk` и не держать там больше артефактов, чем нужно для релиза.
S.

---

## 4. Приоритизированный план

### 2.9.0 — «Честные измерения и целостность данных» (цель: ~2 недели)

| # | Задача | Приоритет | Эффект | Трудоёмкость |
|---|---|---|---|---|
| 9 | Покрытие: печатать две цифры (тестируемые модули / весь `src/`), порог по полному | P1 | Убирает главный самообман; видно 57,8 % → есть куда расти | S |
| 13 | Одно соединение IndexedDB + транзакции пачками | P1 | Устраняет утечку соединений, редкие зависшие чтения подложек | S |
| 14 | `storageHealth()` + баннер квоты + сообщение вместо пустого `catch` | P1 | Пользователь узнаёт о риске потери до потери | S–M |
| 19 | `dirty` через ревизию (не `JSON.stringify` проекта) | P1 | Убирает O(проект) работу на каждый рендер — предпосылка «1000+ объектов» | M |
| 1 | `planRasterWidth()` — DPI-зависимый растр плана | P1 | A1/A0 перестают быть «мылом» | S |
| 30 | CSP в `index.html` **или** удалить обещание; убрать `ACAO: *` из `AssetServer` | P1 | Закрывает разрыв «комментарий обещает — кода нет» | S |
| 24 | Генерируемый блок версии/размера в README + тест на цифры | P1 | Прекращает расхождение README с продуктом | S |
| 6 | `normalizeSegment` → `Segment \| null`, выровнять с остальными | P2 | Битый `.anooplan` даёт сообщение, а не TypeError | S |
| 15 | Список потерянных вложений при импорте `.anooplan` | P2 | Понятная причина вместо «файл битый» | S |
| 10 | Тесты на `useSnapshots` и автосейв-черновик | P1 | Защищает самые приватные правила данных | S ×3 |
| 8a | `key` в «Дополнительных свойствах» + смоук падает на предупреждениях React | P2 | Форма перестаёт путать DOM-узлы; смоук становится сторожем | S |
| 35 | `tsc --noEmit` в `build-apk.sh` | P2 | Релизный APK не собирается из невалидных типов | S |
| 25 | `.gitignore` для `/*.xlsx /*.pdf /*.txt /dl /work` + ручная разборка корня | P2 | Чистый `git status`, нет ложных «исходников» | S |

### 2.10.0 — «Производительность плана и ступень к 3.0» (~1 месяц)

| # | Задача | Приоритет | Эффект | Трудоёмкость |
|---|---|---|---|---|
| 20 | `buildModel(project)` — один расчёт вместо трёх проходов | P2 | 2–3× меньше расчётов на рендер | M |
| 21 | Мемоизация сегментов по этажу + делегирование событий на `<svg>` | P2 | Плавное рисование 500+ сегментов | M |
| 26 | Клавиатурное управление: список объектов → выбор/удаление/сдвиг | P2 | a11y перестаёт быть декоративной | S–M |
| 3 | Чистые редукторы жестов (`snapPoint`, `orthogonalize`, `tapOutcome`) + тесты | P2 | Тестируемость самого багоопасного места | M |
| 2 | Распил `export-pdf.ts` на `pdf/page-kit` + `pdf/sections` | P2 | Риски в главном артефакте снижаются | M |
| 22 | Бюджет на **суммарный** JS и на APK, а не только стартовый чанк | P2 | Рост `export-pdf`/`pdf-worker` перестаёт быть невидимым | S |
| 5 | `Record<string, unknown>` на границе `assertProject`, вернуть `no-explicit-any` | P2 | Компилятор проверяет границу JSON | M |
| 31 | Лимит размера и строк для XLSX/CSV-импорта | P2 | Устойчивость к большим/битым книгам | S |
| 27 | `<ConfirmDialog>` вместо `window.confirm` | P3 | Предсказуемые подтверждения на телефоне | M |
| 34 | Node 24 в `deploy.yml` + `engines` | P2 | Деплой не зависит от experimental-API | S |

### 3.0.0 — «Поле и надёжность» (~квартал, по ROADMAP)

| # | Задача | Приоритет | Эффект | Трудоёмкость |
|---|---|---|---|---|
| 19 | Полный переход на ревизии + инкрементальные патчи проекта | P2 | 1000+ объектов без просадок | L |
| 3 | Распил `useWorkspaceState` на `state/files/plan/objects` | P2 | Устраняет P1-долг HANDOFF | L |
| 37 | Распил `MainActivity.java` + robolectric-тесты чистых функций | P2 | Android-часть перестаёт быть «чёрным ящиком» | M |
| 16 | Golden fixtures по версиям схемы + идемпотентность миграций | P2 | Введение v3 дешёвое и проверяемое | S–M |
| 23 | Единый бюджет памяти: `PLAN_MAX_PIXELS` учитывает кэш-канвас | P2 | Меньше риск выгрузки WebView | S |
| 11 | E2E на «отказ от открытия» и на `QuotaExceededError` | P2 | Уроки с поля — в CI | M |
| 38/39 | Проверка на устройстве: `largeHeap` × WebView, права keystore | P3 | Документированные факты вместо догадок | S |

---

## 5. Быстрые победы (≤ 1 дня)

1. `tsc --noEmit` в `scripts/build-apk.sh` перед `vite build` (находка 35) — 5 минут.
2. `README.md:110`: «версия 2.5.0» → `2.8.0` (находка 24) — 1 минута.
3. `.gitignore`: `/*.xlsx`, `/*.pdf`, `/*.txt`, `/dl/`, `/work/` + вынести/удалить дубликаты
   (находка 25) — 10 минут, но требует ручного решения о `work/calc.py`.
4. CSP-мета **или** удаление комментария `server/app.ts:17` (находка 30) — 20 минут.
5. Убрать `Access-Control-Allow-Origin: *` из `AssetServer.headers()` (находка 30) — 2 минуты.
6. `planRasterWidth()` + тест на A0/A4 (находка 1) — 2–3 часа, самый заметный эффект за день.
7. Лимит 8 МБ / 5000 строк в `readCatalogFile` (находка 31) — 30 минут.
8. Список потерянных вложений вместо `catch { /* ... */ }` в импорте `.anooplan` (находка 15) — 1 час.
9. `idbOpen()` с кэшем соединения (находка 13) — 1–2 часа, снимает целый класс редких ошибок.
10. `storageHealth()` + строка в футере «Хранилище: браузер · N МБ» (находки 14, 28) — 2–3 часа.
11. Тест «покрытие по всему `src/`» второй цифрой в `scripts/coverage.mjs` (находка 9) — 1 час.
12. `key` в `Object.entries(equipment.properties).map` + запрет предупреждений React
    в смоуке (находка 8a) — 30 минут.
13. `normalizeSegment` → `Segment | null` + один тест (находка 6) — 1 час.

---

## 6. Чего НЕ делать / осознанные компромиссы

1. **Не переписывать план на векторный PDF прямо сейчас.** Формулировка «растровый план в PDF —
   мыло» верна, но решение в ROADMAP 2.8.1 — векторный PDF — это переписывание подложки, оверлея
   и шрифтов. `planRasterWidth()` (находка 1) за полдня снимает 80 % боли: 150 dpi вместо 47 на A0.
   Вектор — отдельное решение с собственным бюджетом качества.
2. **`Record<string, any>` на границе API — не «плохой код», а нормальный приём.** Три `any` в
   проекте — это именно валидатор входа, где `unknown` уже проверен. Замечание 5 — про отсутствие
   типовой проверки, а не про необходимость «заменить any на unknown везде».
3. **`unsafe-inline` в CSP для `index.html`** может быть неизбежен из-за ES5-детектора
   `webview-warning` (`index.html:32-45`), который должен выполниться **до** загрузки модулей.
   Вынос в отдельный файл ломает ровно эту гарантию на очень старых WebView. Если решено оставить
   инлайн — это правильный компромисс, и его надо записать в HANDOFF, а не молчать.
4. **Хранение проектов в `localStorage` — осознанно, не меняем.** 5 МБ на список проектов без PDF
   (PDF в IndexedDB) — адекватно для офлайн-приложения; `navigator.storage.persist()` в WebView
   не гарантируется. Единственное, что нужно, — **знать** о давлении на квоту (находка 14),
   а не менять схему хранения. Переход на IndexedDB для проектов даст выигрыш, но потребует
   миграции и не окупится при текущих размерах.
5. **Дублирование `pdfjs-dist/legacy` — вероятно, оправдано.** Legacy-сборка вдвое больше, но
   проект заявляет поддержку WebView 98+ (`README.md:15`), и `legacy` — страховка. Убирать её
   без проверки на реальном устройстве нельзя (проверить здесь не удалось — устройства нет).
6. **Отсутствие rate limiting на Express — принятый риск**, если сервер действительно только
   локальный dev-инструмент. Но лимит тела 150 МБ — не часть этого компромисса, а небрежность;
   его снижение ничего не стоит (находка 29).
7. **`keystore/` в рабочем дереве — не утечка.** Файл не в git и не в истории; замечание 39 —
   про гигиену рабочей машины, а не про раскрытие секрета в репозитории.
8. **Смоук на happy-dom не заменяет E2E — и не должен.** 233 проверки за секунды покрывают
   интеграцию UI, которую юнит-тесты не видят; правильно не «удалить смоук и написать E2E»,
   а добавить прямые тесты хуков (находка 10). Смоук-файл на 980 строк — цена этого компромисса.
9. **`build/` с историей APK — удобно для релиза.** Предложение чистить — про локальное место,
   не про CI-артефакты (те и так уходят в GitHub Release). Удалять историю версий из git
   не нужно: `.apk` в `.gitignore`.

---

## 7. Приложение: как проверялось

Все команды — из `/root/Anooplan`, без изменения репозитория. Ни одна не ставила зависимости.

```bash
# 1. Состояние репозитория
git log --oneline -20
git status --short
#   → 20 коммитов, HEAD 755504c; 7 неотслеживаемых объектов (3 *.xlsx, *.pdf, *.txt, dl/, work/)

# 2. Типы и сборка
npm run build
#   → tsc --noEmit без ошибок; vite build: 292 modules, built in 14.54s;
#     WARN: export-pdf 1171.72 kB, pdf-worker 1271.08 kB, pdf 542.96 kB, xlsx 500.58 kB,
#           index 466.59 kB, css 38.60 kB

# 3. Тесты
npm test
#   → tests 270 | pass 270 | fail 0 | skipped 0 | duration_ms 10814

# 4. Покрытие и пороги
npm run coverage
#   → all files | 95.14 | 87.42 | 95.31 ; lcov 100.4 КБ; пороги 93/85/92 — ok

# 5. Какой охват на самом деле (парсинг lcov + обход src/)
node -e "…(см. ниже)…"
#   → 41 файл в lcov; 41 файл src/ вне lcov на 3458 строк;
#     покрыто 4734/8192 строк src/ = 57.8 %

# 6. Линт, мёртвый код, бюджет, аудит
npm run lint     # → пусто, exit 0
npm run knip     # → пусто, exit 0
npm run size     # → JS 455.7 КБ из 600 (ok), CSS 37.7 КБ из 60 (ok)
npm audit        # → found 0 vulnerabilities

# 7. Риск-паттерны
grep -rn "as any\|: any\b\|<any>\|@ts-ignore\|@ts-expect-error" src/ server/
#   → 3 совпадения, все в server/validation.ts (10, 12) и server/app.ts (80)
grep -rn "eslint-disable" src/ server/ tests/ scripts/   # → 0
grep -rni "TODO\|FIXME\|HACK:\|XXX" src/ server/ scripts/ android/
#   → 1 ложное (слово «одновременно» в сообщении об ошибке geometry.ts:36)
grep -rn "console\." src/ server/                        # → 1 (server/index.ts:7)
grep -rn "innerHTML\|dangerouslySetInnerHTML\|eval(\|new Function" src/   # → 0
grep -rn "Content-Security-Policy" index.html src/ server/                # → 0 (только комментарий app.ts:17)
grep -rn "quota\|QuotaExceeded\|navigator.storage" src/                   # → 0
grep -rn "tabIndex" src/                                                  # → 0
npm run smoke    # → 233 ✔, 0 ✘, «Итог: УСПЕХ»; в stderr —
                 #   «Each child in a list should have a unique "key" prop … from PropertiesPanel»
grep -c "\btest(" tests/e2e/*.spec.ts                                     # → 2+1+1 = 4
grep -c "\btest(" tests/visual/visual.spec.ts                             # → 4
```

Проверка «линтер не видит SVG» (находка 26) — пробные файлы создавались и удалялись внутри `src/`,
после каждого `ls src/__probe.tsx` → `No such file or directory`:

```bash
cat > src/__probe.tsx <<'EOF'
export const Probe = () => <g onPointerDown={() => {}}><circle r={3} onClick={() => {}} /></g>;
EOF
npx eslint src/__probe.tsx            # → пусто, 0 ошибок
# замена <g>/<circle> на <div>/<span> даёт:
#   jsx-a11y/click-events-have-key-events
#   jsx-a11y/no-static-element-interactions
rm -f src/__probe.tsx
```

Парсер покрытия по файлам (короткая версия команды из шага 5):

```bash
node -e "
const fs=require('fs'),path=require('path');
const txt=fs.readFileSync('coverage/lcov.info','utf8');
const covered=new Set([...txt.matchAll(/^SF:(.*)\$/gm)].map(m=>m[1].replace(/.*Anooplan\//,'')));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const src=walk('src').filter(f=>/\.(ts|tsx)\$/.test(f));
const lines=f=>fs.readFileSync(f,'utf8').split('\n').length;
const missing=src.filter(f=>!covered.has(f));
console.log(missing.length,'файлов,',missing.reduce((s,f)=>s+lines(f),0),'строк вне покрытия');
"
```

**Что проверить не удалось и почему:**

- **Реальный APK и Android-поведение:** `android_devices` пуст (нет ни эмулятора, ни USB-устройства),
  поэтому `largeHeap` × WebView, ACTION_VIEW/SEND, `textZoom` на устройстве не проверялись.
  Анализ `MainActivity.java`/`AssetServer.java`/`ShareProvider.java` — только по чтению кода.
- **`deploy.yml` на Node 22:** Node 22 в окружении нет (`/usr/local/lib/nodejs` содержит только
  `node-v24.19.0`), поэтому падение `tests/api.test.ts` на `node:sqlite` — гипотеза по версии API,
  а не воспроизведённый факт.
- **`npm audit` и `xlsx` из tarball-URL:** отчёт говорит «0 уязвимостей», но входит ли URL-зависимость
  в аудит, подтвердить из вывода нельзя (finding 36 помечен как непроверенный).
- **GitHub Pages:** опубликованный сайт не открывался (сети/браузера в окружении нет), вывод
  про устаревшую сборку **снят**: он был основан на имени хеша, но `dist/` пересобран этим же
  прогоном `npm run build`, поэтому сравнивать с опубликованным некорректно.
- **Замеры производительности (находка 19, 20, 21):** оценки O(n) даны по коду (число проходов
  и аллокаций), без профилирования в браузере: Playwright установлен, но профилирование на синтетике
  1000 объектов не запускалось, чтобы не искать «искусственный» результат. Это оценка сложности,
  а не замер FPS.
- **Визуальная регрессия (`npm run test:visual`):** не запускалась — эталоны машинно-зависимы
  (`playwright.visual.config.ts:4-6`), на этой машине результат не имеет смысла.
