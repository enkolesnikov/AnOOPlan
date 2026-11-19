/**
 * Типы для dsh/plugins/dsh-github-tools/lib/core.js.
 *
 * Файл нужен, чтобы тесты в tests/ (они входят в tsconfig) могли импортировать
 * `../dsh/plugins/dsh-github-tools/lib/core.js`: TS разрешает `./core.js`
 * в `core.d.ts`. Сам плагин остаётся обычным ESM-модулем без сборки.
 */

export interface GithubToolsConfig {
  /** Владелец/репозиторий, например 'enkolesnikov/AnOOPlan'. */
  repoSlug?: string;
  /** База GitHub API; undefined — https://api.github.com. */
  apiBase?: string | null;
  /** Корень workspace для путей к ассетам; undefined — process.cwd(). */
  root?: string;
}

export interface GithubReleaseAsset {
  name: string;
  size: number;
  state: string;
}

export interface GithubReleaseResult {
  ok: boolean;
  tag?: string;
  name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  publishedAt?: string | null;
  url?: string;
  bodyLines?: number;
  assets?: GithubReleaseAsset[];
  problems: string[];
}

export interface GithubReleaseUploadResult {
  ok: boolean;
  dryRun?: boolean;
  tag?: string;
  assetName?: string;
  sizeBytes?: number;
  uploadUrl?: boolean;
  asset?: GithubReleaseAsset & { url: string };
  localSize?: number;
  problems: string[];
}

/**
 * Нормализует базовый адрес GitHub API (срезает хвостовые слэши).
 *
 * @throws TypeError если apiBase — не строка и не undefined/null/''
 * @throws RangeError если строка длиннее 2048 символов
 */
export function normalizeBaseUrl(apiBase?: unknown): string;

/** Информация о релизе: активы, статус, ссылка. */
export function githubRelease(
  config: GithubToolsConfig,
  options?: { tag?: string },
): Promise<GithubReleaseResult>;

/** Загрузка файла в релиз по тегу; путь ограничен workspace. */
export function githubReleaseUpload(
  config: GithubToolsConfig,
  options?: { tag?: string; file?: string; name?: string; dryRun?: boolean },
): Promise<GithubReleaseUploadResult>;
