/**
 * dsh-github-tools — GitHub-инструменты для DSH: релизы, загрузка ассетов,
 * статус workflow-runs и issues. Токен — только из окружения.
 *
 * @module dsh-github-tools
 */
import { githubIssues, githubRelease, githubReleaseUpload, githubWorkflowRuns } from './core.js';

export const name = 'dsh-github-tools';
export const inject = ['tools'];

const DEFAULTS = {
  repoSlug: 'enkolesnikov/AnOOPlan',
  apiBase: 'https://api.github.com',
  root: '/root/Anooplan',
};

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { json: { type: 'string' }, markdown: { type: 'string' } },
    required: ['json', 'markdown'],
  },
  render: (_args, value) => [{ type: 'text', text: value.markdown || value.json }],
};

function renderRelease(result) {
  if (!result.ok) return ['GitHub Release: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  return [
    `Релиз: ${result.tag}${result.name ? ` — ${result.name}` : ''}`,
    `draft: ${result.draft ? 'да' : 'нет'} · prerelease: ${result.prerelease ? 'да' : 'нет'}`,
    `Опубликован: ${result.publishedAt ?? '—'}`,
    `Ссылка: ${result.url}`,
    `Описание: ${result.bodyLines} строк`,
    'Активы:',
    ...result.assets.map(asset => `- ${asset.name} — ${asset.size} Б (${asset.state})`),
  ].join('\n');
}

function renderUpload(result) {
  if (!result.ok) return ['Загрузка ассета: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  return `Ассет загружен в ${result.tag}: ${result.asset.name} — ${result.asset.size} Б`;
}

function renderRuns(result) {
  if (!result.ok) return ['Workflow runs: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  return [
    `Запуски (${result.runs.length}):`,
    ...result.runs.map(run => `- ${run.name}: ${run.status}/${run.conclusion ?? '—'} · ${run.headSha} · ${run.durationSeconds ?? '?'} с`),
  ].join('\n');
}

function renderIssues(result) {
  if (!result.ok) return ['Issues: ошибка', ...result.problems.map(p => `- ${p}`)].join('\n');
  if (result.issues.length === 0) return 'Issues: нет';
  return [`Issues (${result.issues.length}):`, ...result.issues.map(issue => `- #${issue.number} ${issue.title}`)].join('\n');
}

/** Регистрирует GitHub-инструменты. */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  ctx.tools.register({
    name: 'github_release',
    description: 'Read a GitHub release by tag (or the latest): name, draft/prerelease, body size, assets with sizes. Public read; uses GH_TOKEN/GITHUB_TOKEN when present.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', description: 'Release tag (e.g. v2.5.0); omit for latest.' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await githubRelease(cfg, { tag: args.tag });
      return { json: JSON.stringify(result, null, 2), markdown: renderRelease(result) };
    },
  });

  ctx.tools.register({
    name: 'github_release_upload',
    description: 'Upload a local file as a release asset by tag. Requires GH_TOKEN/GITHUB_TOKEN with contents:write; the path is resolved against the repository root.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', description: 'Release tag; required.' },
        file: { type: 'string', description: 'Local file path (absolute or relative to the repo root); required.' },
        name: { type: 'string', description: 'Optional asset name; defaults to the file basename.' },
      },
      required: ['tag', 'file'],
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await githubReleaseUpload(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderUpload(result) };
    },
  });

  ctx.tools.register({
    name: 'github_workflow_runs',
    description: 'List recent GitHub Actions runs with status/conclusion and duration, filtered by commit sha or branch.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sha: { type: 'string', description: 'Optional commit sha (full or short) to filter runs.' },
        branch: { type: 'string', description: 'Optional branch name; ignored when sha is set.' },
        limit: { type: 'number', description: 'Number of runs, 1–30 (default 5).' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await githubWorkflowRuns(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderRuns(result) };
    },
  });

  ctx.tools.register({
    name: 'github_issues',
    description: 'List repository issues (pull requests excluded) with number, title, state and labels.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state (default open).' },
        limit: { type: 'number', description: 'Number of issues, 1–100 (default 20).' },
      },
    },
    output: OUTPUT,
    async execute(args = {}) {
      const result = await githubIssues(cfg, args);
      return { json: JSON.stringify(result, null, 2), markdown: renderIssues(result) };
    },
  });
}
