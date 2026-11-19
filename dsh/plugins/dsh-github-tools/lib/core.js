/**
 * Дополнение к @perrylink/dsh-github: то, чего нет в маркет-плагине —
 * чтение релиза и загрузка/проверка релизных ассетов. Issues, PR, review и CI
 * даёт @perrylink/dsh-github (инструменты gh_ и pr_), здесь они не дублируются.
 *
 * Только fetch (Node 18+), без octokit. Токен — GH_TOKEN/GITHUB_TOKEN из
 * окружения; публичное чтение работает без него.
 *
 * @module dsh-github-tools/core
 */
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const DEFAULT_API_BASE = 'https://api.github.com';
/** Хост загрузки ассетов публичного GitHub: upload_url приходит с него, а не с api.github.com. */
const UPLOAD_HOST = 'uploads.github.com';
/** Предел длины apiBase: защита от злоупотребления памятью и временем. */
const MAX_API_BASE_LENGTH = 2048;

export function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* код '/' */) end -= 1;
  return value.slice(0, end);
}

/**
 * Приводит базовый адрес GitHub API к виду без хвостовых слэшей.
 *
 * Разбор линейный — цикл по charCodeAt с конца и slice, без регэкспов:
 * шаблон /\/+$/ на строке из миллионов слэшей даёт квадратичное время
 * (js/polynomial-redos). Вход ограничен по длине, поэтому злоупотребление
 * гигантской строкой отклоняется сразу, до какого-либо разбора.
 *
 * @param {unknown} apiBase адрес из конфига; undefined/null/'' — значение по умолчанию
 * @returns {string}
 * @throws {TypeError} если apiBase не строка и не пустое значение
 * @throws {RangeError} если строка длиннее MAX_API_BASE_LENGTH
 */
export function normalizeBaseUrl(apiBase) {
  if (apiBase === undefined || apiBase === null || apiBase === '') return DEFAULT_API_BASE;
  if (typeof apiBase !== 'string') {
    throw new TypeError('apiBase должен быть строкой — проверьте конфигурацию плагина');
  }
  if (apiBase.length > MAX_API_BASE_LENGTH) {
    throw new RangeError(`apiBase длиннее ${MAX_API_BASE_LENGTH} символов — вероятно, это ошибка конфигурации`);
  }
  return trimTrailingSlashes(apiBase);
}

function baseUrl(config) {
  return normalizeBaseUrl(config.apiBase);
}

/**
 * Проверяет, что upload_url ведёт на тот же хост, что и API (или на
 * uploads.github.com для публичного GitHub). Без этого токен ушёл бы на любой
 * хост из ответа API, а fetch стал бы SSRF-каналом.
 * @returns {string} пустая строка — адрес допустим, иначе текст проблемы
 */
function uploadUrlProblem(uploadUrl, apiBase) {
  let url;
  let base;
  try {
    url = new URL(uploadUrl);
    base = new URL(normalizeBaseUrl(apiBase));
  } catch {
    return 'upload_url: некорректный адрес';
  }
  const allowed = new Set([base.host]);
  if (base.host === 'api.github.com') allowed.add(UPLOAD_HOST);
  if (url.protocol !== base.protocol) return `upload_url: ожидается ${base.protocol}, получен ${url.protocol}`;
  if (!allowed.has(url.host)) return `upload_url ведёт на чужой хост: ${url.host}`;
  return '';
}

function credentialStoreToken() {
  // Токен, добавленный через веб-интерфейс DSH (Plugins → GitHub), лежит в
  // ~/.dsh/.credentials.yaml. Читаем только значение GITHUB_TOKEN/GH_TOKEN и
  // никогда не печатаем его; env имеет приоритет.
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = join(home, '.credentials.yaml');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // Файла нет или он недоступен — токена в хранилище нет.
    return '';
  }
  // Построчный разбор: регэксп с /m и ленивым (.+?) на файле из переводов строк
  // даёт квадратичный бэктрекинг (js/polynomial-redos). Размер ограничен.
  for (const line of text.slice(0, 64 * 1024).split('\n')) {
    const match = /^\s*(?:GITHUB_TOKEN|GH_TOKEN):\s*(.*)$/.exec(line);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function authToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || credentialStoreToken();
}

async function request(config, path, { method = 'GET', body, contentType, token, timeoutMs = 30_000 } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-github-tools',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const auth = token || authToken();
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (contentType) headers['Content-Type'] = contentType;
  try {
    // codeql[js/file-access-to-http] — осознанная отправка тела запроса в GitHub API
    const response = await fetch(`${baseUrl(config)}${path}`, {
      method, headers, body, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: text.slice(0, 500) };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

function releasePath(config, tag) {
  return tag === 'latest'
    ? `/repos/${config.repoSlug}/releases/latest`
    : `/repos/${config.repoSlug}/releases/tags/${encodeURIComponent(tag)}`;
}

function releaseSummary(release) {
  return {
    tag: release.tag_name,
    name: release.name,
    draft: release.draft,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    url: release.html_url,
    bodyLines: String(release.body ?? '').split('\n').length,
    assets: (release.assets ?? []).map(asset => ({ name: asset.name, size: asset.size, state: asset.state })),
  };
}

/** Информация о релизе: активы, статус, ссылка. */
export async function githubRelease(config, { tag = 'latest' } = {}) {
  const result = await request(config, releasePath(config, tag));
  if (!result.ok) return { ok: false, tag, problems: [`GitHub API ${result.status}: ${result.error}`] };
  return { ok: true, ...releaseSummary(result.data), problems: [] };
}

/**
 * Загрузка файла в релиз по тегу. Требует GH_TOKEN/GITHUB_TOKEN с contents:write.
 *
 * Почему содержимое локального файла уходит в сеть: это и есть цель функции —
 * прочитать релизный ассет (APK/PNG) и отправить его в GitHub Releases API.
 * Ограничения, которые делают это безопасным:
 *  - файл обязан лежать внутри workspace (config.root или process.cwd()):
 *    realpath раскрывает симлинки, побег за корень отклоняется до чтения;
 *    дескриптор открывается с O_NOFOLLOW, размер и чтение идут из него же —
 *    между проверкой и чтением нет окна (js/file-system-race);
 *  - назначение — upload_url из ответа API, причём только на хост самого API
 *    или uploads.github.com: токен не уйдёт на чужой хост (SSRF);
 *  - токен не логируется и не попадает ни в результат, ни в текст ошибок.
 * Алерт js/file-access-to-http подавлен точечно на вызове загрузки.
 */
export async function githubReleaseUpload(config, { tag, file, name, dryRun = false } = {}) {
  if (!tag) return { ok: false, problems: ['нужен tag релиза'] };
  if (!file) return { ok: false, problems: ['нужен file — путь к ассету'] };
  if (!authToken()) return { ok: false, problems: ['нет GH_TOKEN/GITHUB_TOKEN в окружении'] };

  let root;
  try {
    root = realpathSync(resolve(config.root || process.cwd()));
  } catch (error) {
    return { ok: false, problems: [`workspace недоступен: ${error.message}`] };
  }
  let target;
  // Лексическая проверка до realpath: для несуществующего '../outside.apk'
  // сообщение должно говорить о выходе из workspace, а не о ENOENT.
  const lexical = resolve(root, file);
  const lexicalRel = relative(root, lexical);
  if (lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || isAbsolute(lexicalRel)) {
    return { ok: false, problems: [`файл вне workspace: ${file}`] };
  }
  try {
    target = realpathSync(lexical);
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, problems: [`файл не найден: ${file}`] };
    return { ok: false, problems: [`файл недоступен: ${file}: ${error.message}`] };
  }
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, problems: [`файл вне workspace: ${file}`] };
  }

  let fd;
  try {
    // O_NOFOLLOW: последний компонент не может быть симлинком (realpath его уже
    // раскрыл, но подмена между realpath и open иначе была бы возможна).
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return { ok: false, problems: [`файл недоступен: ${file}: ${error.message}`] };
  }

  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, problems: [`не обычный файл: ${file}`] };
    const sizeBytes = stat.size;

    const release = await request(config, releasePath(config, tag));
    if (!release.ok) return { ok: false, problems: [`релиз ${tag}: GitHub API ${release.status}`] };
    const uploadUrl = String(release.data.upload_url ?? '').split('{')[0];
    if (!uploadUrl) return { ok: false, problems: ['у релиза нет upload_url'] };
    const urlProblem = uploadUrlProblem(uploadUrl, config.apiBase);
    if (urlProblem) return { ok: false, problems: [urlProblem] };

    const assetName = name || basename(target);
    if (dryRun) {
      return { ok: true, dryRun: true, tag, assetName, sizeBytes, uploadUrl: Boolean(uploadUrl), problems: [] };
    }
    const contentType = /\.png$/i.test(assetName) ? 'image/png'
      : /\.apk$/i.test(assetName) ? 'application/vnd.android.package-archive'
        : 'application/octet-stream';
    // Читаем из уже проверенного дескриптора: путь между проверкой и чтением
    // повторно не используется.
    const body = readFileSync(fd);
    // codeql[js/file-access-to-http] — осознанная загрузка ассета в GitHub Releases (см. пояснение выше)
    const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
      method: 'POST',
      headers: { // codeql[js/file-access-to-http] — уходит токен из credential store, назначение проверено выше
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${authToken()}`,
        'Content-Type': contentType,
        'User-Agent': 'dsh-github-tools',
      },
      body, // codeql[js/file-access-to-http] — тело — проверенный ассет из workspace
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      return { ok: false, problems: [`upload ${response.status}: ${(await response.text()).slice(0, 300)}`] };
    }
    const asset = await response.json();
    return {
      ok: true,
      tag,
      asset: { name: asset.name, size: asset.size, state: asset.state, url: asset.browser_download_url },
      localSize: sizeBytes,
      problems: [],
    };
  } catch (error) {
    return { ok: false, problems: [`upload: ${error.message}`] };
  } finally {
    closeSync(fd);
  }
}
