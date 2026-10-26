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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

function baseUrl(config) {
  return (config.apiBase || 'https://api.github.com').replace(/\/+$/, '');
}

function credentialStoreToken() {
  // Токен, добавленный через веб-интерфейс DSH (Plugins → GitHub), лежит в
  // ~/.dsh/.credentials.yaml. Читаем только значение GITHUB_TOKEN/GH_TOKEN и
  // никогда не печатаем его; env имеет приоритет.
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = join(home, '.credentials.yaml');
  if (!existsSync(file)) return '';
  try {
    const text = readFileSync(file, 'utf8');
    const match = /^\s*(?:GITHUB_TOKEN|GH_TOKEN):\s*(.+?)\s*$/m.exec(text);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch {
    return '';
  }
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

/** Загрузка файла в релиз по тегу. Требует GH_TOKEN/GITHUB_TOKEN с contents:write. */
export async function githubReleaseUpload(config, { tag, file, name, dryRun = false } = {}) {
  if (!tag) return { ok: false, problems: ['нужен tag релиза'] };
  if (!file) return { ok: false, problems: ['нужен file — путь к ассету'] };
  if (!authToken()) return { ok: false, problems: ['нет GH_TOKEN/GITHUB_TOKEN в окружении'] };
  const target = resolve(config.root || process.cwd(), file);
  if (!existsSync(target)) return { ok: false, problems: [`файл не найден: ${file}`] };

  const release = await request(config, releasePath(config, tag));
  if (!release.ok) return { ok: false, problems: [`релиз ${tag}: GitHub API ${release.status}`] };
  const uploadUrl = String(release.data.upload_url ?? '').split('{')[0];
  if (!uploadUrl) return { ok: false, problems: ['у релиза нет upload_url'] };

  const assetName = name || basename(target);
  if (dryRun) {
    return { ok: true, dryRun: true, tag, assetName, sizeBytes: statSync(target).size, uploadUrl: Boolean(uploadUrl), problems: [] };
  }
  const contentType = /\.png$/i.test(assetName) ? 'image/png'
    : /\.apk$/i.test(assetName) ? 'application/vnd.android.package-archive'
      : 'application/octet-stream';
  const body = readFileSync(target);
  try {
    const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${authToken()}`,
        'Content-Type': contentType,
        'User-Agent': 'dsh-github-tools',
      },
      body,
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
      localSize: statSync(target).size,
      problems: [],
    };
  } catch (error) {
    return { ok: false, problems: [`upload: ${error.message}`] };
  }
}
