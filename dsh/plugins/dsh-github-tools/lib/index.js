/**
 * dsh-github-tools — дополнение к @perrylink/dsh-github.
 *
 * PR, issues, review и CI даёт маркет-плагин; здесь только релизные ассеты:
 *   github_release        — чтение релиза по тегу;
 *   github_release_upload — загрузка файла в релиз.
 *
 * @module dsh-github-tools
 */
import { githubRelease, githubReleaseUpload } from './core.js';

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

/** Регистрирует релизные инструменты. */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  ctx.tools.register({
    name: 'github_release',
    description: 'Read a GitHub release by tag (or the latest): assets, sizes, draft/prerelease. Complements @perrylink/dsh-github, which covers PRs/issues/CI but not release assets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', description: 'Release tag (e.g. v2.6.0); omit for latest.' },
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
}
