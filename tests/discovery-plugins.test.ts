import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { markdownFile, markdownModel } from '../src/core/markdown-model';
import { discoveryProviders } from '../src/core/discovery-profiles';
import { mergeProposal, pluginProposal } from '../src/core/id-discovery';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { indexProject } from '../src/core/project-index';
import { parseDiscoveryResult } from '../src/shared/plugin-runtime';
import { appliesError, validateManifest, type DiscoveryRequest } from '../packages/plugin-api/src/index';

/** Increment 97c: discovery contributions, the markdown@1 model, and the Spec Kitty example plugin. */
const prompt = (id: string, title: string, subtasks: string[], dependencies: string[] = []) =>
  `---\nwork_package_id: ${id}\ntitle: ${title}\ndependencies: [${dependencies.join(', ')}]\nsubtasks:\n${subtasks.map(t => `- ${t}`).join('\n')}\nhistory:\n- timestamp: '2025-12-25T02:30:00Z'\n  lane: planned\nwp_code: ${id}\n---\n\n# Work Package Prompt: ${id} – ${title}\n\n## Objective\n\nDo ${title}.\n`;
const tasks = (packages: [string, string[], string?][]) => `# Work Packages\n\n${packages.map(([id, subtasks, depends]) => `## Work Package ${id}: Work\n\n**Prompt**: \`tasks/${id}-work.md\`\n\n${subtasks.map(t => `- [x] ${t} Do ${t}`).join('\n')}\n${depends ? `\n### Dependencies\n\n- Depends on ${depends}.\n` : ''}`).join('\n')}`;
const KITTY: Record<string, string> = {
  'kitty-specs/001-a/tasks/WP01-work.md': prompt('WP01', 'Setup', ['T001', 'T002']),
  'kitty-specs/001-a/tasks/WP02-work.md': prompt('WP02', 'Build', ['T003'], ['WP01']),
  'kitty-specs/001-a/tasks.md': tasks([['WP01', ['T001', 'T002']], ['WP02', ['T003'], 'WP01']]),
  'kitty-specs/002-b/tasks/WP01-work.md': prompt('WP01', 'Again', ['T001']),
  'kitty-specs/002-b/tasks.md': tasks([['WP01', ['T001']], ['WP02', ['T002']]]),
  'kitty-specs/002-b/spec.md': '# Spec\n\nSee WP01 and T001.\n',
};
const request = (documents: Record<string, string>): DiscoveryRequest => ({ apiVersion: '0.2.0', requestId: 'r1', context: { projectId: 'p', revision: 1 }, models: { markdown: markdownModel(documents, 1) } });
const kitty = async () => import(pathToFileURL(path.resolve('examples/plugins/spec-kitty/index.js')).href) as Promise<{ discover(request: DiscoveryRequest): any }>;

test('markdown@1 parses front matter as data, keeps file offsets, and lists headings, items, and tables', () => {
  const text = '---\ntitle: A\nsubtasks:\n- T001\n---\n# One\n\n## Two\n\n- [x] T001 Done\n  - nested\n\n| ID | Name |\n| -- | ---- |\n| R1 | Rule |\n\nText here.\n';
  const file = markdownFile('a.md', text);
  assert.deepEqual(file.frontMatter, { range: { file: 'a.md', start: 0, end: 34 }, data: { title: 'A', subtasks: ['T001'] } });
  assert.deepEqual(file.headings.map(h => [h.depth, h.text, h.parent, text.slice(h.range.start, h.range.end)]), [[1, 'One', undefined, '# One'], [2, 'Two', 0, '## Two']]);
  assert.deepEqual(file.blocks.map(b => b.kind === 'table' ? [b.kind, b.rows, b.heading] : [b.kind, b.text, b.heading, ...(b.kind === 'list-item' ? [b.depth, b.checked] : [])]),
    [['list-item', 'T001 Done', 1, 0, true], ['list-item', 'nested', 1, 1, undefined], ['table', [['ID', 'Name'], ['R1', 'Rule']], 1], ['paragraph', 'Text here.', 1]]);
  // The front matter is not read as Markdown; invalid YAML is reported, and the model is bounded.
  assert.equal(markdownFile('b.md', '---\na: [\n---\n# B\n').frontMatter!.range.end, 13);
  assert.ok('error' in markdownFile('b.md', '---\na: [\n---\n# B\n').frontMatter!);
  assert.deepEqual(markdownFile('b.md', '---\na: [\n---\n# B\n').headings.map(h => h.text), ['B']);
  assert.equal(markdownFile('c.md', '# No front matter\n').frontMatter, undefined);
  assert.deepEqual(markdownModel({ 'b.md': '# B', 'a.md': '# A' }, 3).files.map(f => f.file), ['a.md', 'b.md']);
});

test('only a discovery contribution reads markdown@1, and it may declare no views', () => {
  const base = { manifestVersion: 1, id: 'test.kitty', version: '1.0.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read'], models: ['markdown@1'], views: [] };
  const discovery = { tool: 'Spec Kitty', versions: '0.x' };
  assert.equal(validateManifest({ ...base, discovery }).ok, true);
  const without = validateManifest(base);
  assert.equal(without.ok, false);
  assert.ok(!without.ok && without.errors.includes('markdown@1 is readable only with a discovery contribution.'));
  assert.ok(!without.ok && without.errors.some(e => e.startsWith('Declare 1-32 views')));
  assert.equal(validateManifest({ ...base, models: ['physical@1', 'markdown@1'], views: [{ id: 'v', title: 'V', kind: 'list' }] }).ok, false);
  assert.equal(validateManifest({ ...base, discovery: { tool: '', versions: '0.x' } }).ok, false);
  assert.equal(validateManifest({ ...base, discovery: { ...discovery, extra: 1 } }).ok, false);
  // Discovery plugins appear among the providers, after the profiles, with a switch kept in the configuration.
  const plugin = { id: 'test.kitty', tool: 'Spec Kitty', versions: '0.x' };
  const off = discoveryProviders([], { disabled: ['test.kitty'] }, [plugin]);
  assert.deepEqual(off.providers.map(p => [p.tool, p.source, p.enabled]), [['Kiro', 'bundled', false], ['Spec Kit', 'bundled', false], ['Trae', 'bundled', false], ['Spec Kitty', 'plugin', false]]);
  assert.deepEqual([off.plugins, discoveryProviders([], {}, [plugin]).plugins], [[], [plugin]]);
  // 97d: a plugin's applicability comes from its manifest; where it does not apply, it is not run unless turned on.
  const applies = { files: '**/kitty-specs/*/tasks/*.md', min: 2 }, kitty = { ...plugin, applies };
  const prompts = ['kitty-specs/001-a/tasks/WP01-a.md', 'kitty-specs/001-a/tasks/WP02-b.md'];
  assert.deepEqual(discoveryProviders([], {}, [kitty], prompts).providers[3], { ...plugin, source: 'plugin', applies: true, declared: true, files: 2, example: prompts[0], enabled: true });
  assert.deepEqual([discoveryProviders([], {}, [kitty], prompts.slice(1)).plugins, discoveryProviders([], { enabled: ['test.kitty'] }, [kitty], []).plugins], [[], [kitty]]);
  assert.equal(validateManifest({ ...base, discovery: { ...discovery, applies } }).ok, true);
  assert.deepEqual(validateManifest({ ...base, discovery: { ...discovery, applies: { files: 'a', min: 0 } } }), { ok: false, errors: [`discovery.${appliesError({ files: 'a', min: 0 })}`] });
  assert.deepEqual(validateIdConfiguration({ version: 1, categories: [], rules: [], discoveryProviders: { disabled: ['spec-kit', 'test.kitty'] } }).discoveryProviders, { disabled: ['spec-kit', 'test.kitty'] });
});

test('the Spec Kitty plugin proposes work packages and subtasks per feature, with gaps; staged, they define without duplicates', async () => {
  const { discover } = await kitty();
  const result = parseDiscoveryResult(JSON.stringify(discover(request(KITTY))), request(KITTY));
  const { suggestions, gaps } = pluginProposal('Spec Kitty', result, KITTY, new Set());
  assert.deepEqual(suggestions.map(s => [s.category.name, s.provider, s.category.idScopes, s.category.definitionPaths]), [
    ['Work package', 'Spec Kitty', [{ pattern: 'kitty-specs/*' }], ['kitty-specs/*/tasks/*.md']],
    ['Subtask', 'Spec Kitty', [{ pattern: 'kitty-specs/*' }], ['kitty-specs/*/tasks.md']]]);
  assert.match(suggestions[0].uncertainty, /^3 work package prompts in 2 feature folders of kitty-specs\//);
  assert.deepEqual(gaps.map(g => g.text.split(' (')[0]), ['1 dependency between work packages are written in front matter or as "Depends on" lines in tasks.md', '3 work packages list their subtasks in front matter', '3 work packages record their lane', '1 work package in 1 feature']);
  assert.match(gaps[0].text, /WP02 depends on WP01 in 001-a/);
  const draft = mergeProposal(validateIdConfiguration({ version: 1, categories: [], rules: [] }), { version: 1, suggestions });
  const index = indexProject(KITTY, draft);
  const defined = (key: string) => index.definitions.filter(o => o.category?.key === key).map(o => `${o.scope}:${o.id}`).sort();
  assert.deepEqual(defined('spec-kitty-work-package'), ['kitty-specs/001-a:WP01', 'kitty-specs/001-a:WP02', 'kitty-specs/002-b:WP01']);
  assert.deepEqual(defined('spec-kitty-subtask'), ['kitty-specs/001-a:T001', 'kitty-specs/001-a:T002', 'kitty-specs/001-a:T003', 'kitty-specs/002-b:T001', 'kitty-specs/002-b:T002']);
  // WP02 of 002-b has no prompt file, so its heading in tasks.md refers to it (the last gap).
  assert.ok(index.references.some(o => o.id === 'WP02' && o.scope === 'kitty-specs/002-b'));
});

test('a discovery result is checked: stale or oversized results, invalid suggestions, and colliding keys', async () => {
  const req = request(KITTY);
  assert.throws(() => parseDiscoveryResult(JSON.stringify({ apiVersion: '0.2.0', requestId: 'old', suggestions: [] }), req), /stale/);
  assert.throws(() => parseDiscoveryResult(JSON.stringify({ apiVersion: '0.2.0', requestId: 'r1', suggestions: Array(33).fill({}) }), req), /at most 32/);
  assert.throws(() => parseDiscoveryResult(JSON.stringify({ apiVersion: '0.2.0', requestId: 'r1', suggestions: [], gaps: [{ text: '' }] }), req), /16 gaps/);
  const { discover } = await kitty();
  const result = discover(req);
  // Evidence that does not match the Markdown is rejected, like any proposal's.
  const stale = structuredClone(result); stale.suggestions[0].evidence[0].offset += 1;
  assert.throws(() => pluginProposal('Spec Kitty', stale, KITTY, new Set()), /evidence/);
  // Keys the review already uses are renamed, and the plugin's references follow.
  const { suggestions } = pluginProposal('Spec Kitty', result, KITTY, new Set(['spec-kitty-work-package']));
  assert.deepEqual(suggestions.map(s => [s.key, s.category.key, s.rule!.category]), [['spec-kitty-work-package-2', 'spec-kitty-work-package-2', 'spec-kitty-work-package-2'], ['spec-kitty-subtask', 'spec-kitty-subtask', 'spec-kitty-subtask']]);
  // Gap examples that do not match the text are dropped.
  const gapped = { suggestions: [], gaps: [{ text: 'Note', evidence: [{ id: 'nope', file: 'kitty-specs/002-b/spec.md', offset: 0, end: 4, context: 'mention' }, { id: 'WP01', file: 'kitty-specs/002-b/spec.md', offset: 12, end: 16, context: 'mention' }] }] };
  assert.deepEqual(pluginProposal('T', gapped, KITTY, new Set()).gaps, [{ tool: 'T', text: 'Note', evidence: [{ id: 'WP01', file: 'kitty-specs/002-b/spec.md', offset: 12, end: 16, context: 'mention' }] }]);
  // The plugin needs at least two work package prompts.
  assert.deepEqual(discover(request({ 'kitty-specs/001-a/tasks/WP01-work.md': KITTY['kitty-specs/001-a/tasks/WP01-work.md'] })).suggestions, []);
  assert.equal(JSON.parse(await readFile('examples/plugins/spec-kitty/specular-plugin.json', 'utf8')).discovery.tool, 'Spec Kitty');
});
