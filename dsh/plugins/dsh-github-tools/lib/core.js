/**
 * GitHub-инструменты для DSH: релизы, загрузка ассетов, workflow-runs, issues.
 * Использует только fetch (Node 18+), без octokit. Токен читается из
 * GH_TOKEN/GITHUB_TOKEN, в файлы не пишется; публичное чтение работает без него.
 *
 * @module dsh-github-tools/core
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function baseUrl(config) {
  return (config.apiBase || 'https://api.github.com').replace(/\/+$/, '');
}

function authToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
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
export async function githubReleaseUpload(config, { tag, file, name } = {}) {
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

/** Список запусков workflow: статус, вывод, длительность. */
export async function githubWorkflowRuns(config, { sha, branch, limit = 5 } = {}) {
  const params = new URLSearchParams({ per_page: String(Math.min(Math.max(Number(limit) || 5, 1), 30)) });
  if (sha) {
    // GitHub API фильтрует runs только по полному sha: короткий резолвим через commits API.
    let fullSha = sha;
    if (sha.length < 40) {
      const commit = await request(config, `/repos/${config.repoSlug}/commits/${encodeURIComponent(sha)}`);
      if (commit.ok) fullSha = commit.data.sha;
    }
    params.set('head_sha', fullSha);
  } else if (branch) {
    params.set('branch', branch);
  }
  const result = await request(config, `/repos/${config.repoSlug}/actions/runs?${params}`);
  if (!result.ok) return { ok: false, problems: [`GitHub API ${result.status}: ${result.error}`] };
  const runs = (result.data.workflow_runs ?? []).map(run => ({
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha?.slice(0, 7),
    branch: run.head_branch,
    createdAt: run.created_at,
    durationSeconds: run.run_started_at && run.updated_at
      ? Math.round((Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / 1000)
      : null,
    url: run.html_url,
  }));
  return { ok: true, total: runs.length, runs, problems: [] };
}

/** Открытые/закрытые issues (PR исключаются). */
export async function githubIssues(config, { state = 'open', limit = 20 } = {}) {
  const params = new URLSearchParams({ state, per_page: String(Math.min(Math.max(Number(limit) || 20, 1), 100)) });
  const result = await request(config, `/repos/${config.repoSlug}/issues?${params}`);
  if (!result.ok) return { ok: false, problems: [`GitHub API ${result.status}: ${result.error}`] };
  const issues = (result.data ?? [])
    .filter(item => item.pull_request === undefined)
    .map(item => ({
      number: item.number,
      title: item.title,
      state: item.state,
      labels: (item.labels ?? []).map(label => (typeof label === 'string' ? label : label.name)),
      url: item.html_url,
    }));
  return { ok: true, total: issues.length, issues, problems: [] };
}
